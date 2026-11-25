#!/usr/bin/env python3
"""
LoRA fine-tune for the LPU Admission Assistant.

This trains BEHAVIOUR: answer shape, language mirroring, and the refusal rules
(no invented fees, no admission guarantees, no application-status claims).
It does not train facts. Fees, cutoffs and slabs must keep coming from retrieval,
because a fine-tuned model cannot be updated when the admission session changes.

Run on a GPU. A free Colab T4 is enough for a 0.5B-1B model with this dataset.

    pip install "transformers>=4.44" "peft>=0.12" "datasets>=2.20" accelerate bitsandbytes
    python train/train_lora.py --model Qwen/Qwen2.5-0.5B-Instruct --out out/lpu-lora

Then serve the adapter with any OpenAI-compatible stack, or merge it:
    python train/train_lora.py --model ... --out ... --merge --merged-out out/lpu-merged

NOTE: this script was written and syntax-checked but NOT executed here, because
this sandbox has no GPU and no torch. Expect to tune epochs and learning rate on
your own hardware. Verify outputs against the refusal rules before deploying.
"""

import argparse
import json
import os
from dataclasses import dataclass

import torch
from datasets import load_dataset
from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    DataCollatorForLanguageModeling,
    Trainer,
    TrainingArguments,
)


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--model", default="Qwen/Qwen2.5-0.5B-Instruct")
    p.add_argument("--train", default="train/train.jsonl")
    p.add_argument("--valid", default="train/valid.jsonl")
    p.add_argument("--out", default="out/lpu-lora")
    p.add_argument("--epochs", type=float, default=3.0)
    p.add_argument("--lr", type=float, default=2e-4)
    p.add_argument("--batch", type=int, default=2)
    p.add_argument("--grad-accum", type=int, default=8)
    p.add_argument("--max-len", type=int, default=1024)
    p.add_argument("--lora-r", type=int, default=16)
    p.add_argument("--lora-alpha", type=int, default=32)
    p.add_argument("--lora-dropout", type=float, default=0.05)
    p.add_argument("--4bit", dest="four_bit", action="store_true", help="load the base model in 4-bit")
    p.add_argument("--merge", action="store_true", help="merge the adapter into the base model and save")
    p.add_argument("--merged-out", default="out/lpu-merged")
    return p.parse_args()


def build_tokenizer(path):
    tok = AutoTokenizer.from_pretrained(path, trust_remote_code=True)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    tok.padding_side = "right"
    return tok


def to_text(example, tokenizer):
    """Render a messages list with the model's own chat template."""
    messages = example["messages"]
    text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)
    return {"text": text}


def tokenize_and_mask(example, tokenizer, max_len):
    """Tokenize, and mask the prompt tokens so the loss only covers the answer."""
    messages = example["messages"]
    prompt_messages = [m for m in messages if m["role"] != "assistant"]
    answer = messages[-1]["content"]

    prompt_text = tokenizer.apply_chat_template(prompt_messages, tokenize=False, add_generation_prompt=True)
    full_text = tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)

    prompt_ids = tokenizer(prompt_text, add_special_tokens=False)["input_ids"]
    full = tokenizer(full_text, add_special_tokens=False, truncation=True, max_length=max_len)
    input_ids = full["input_ids"]

    labels = list(input_ids)
    mask_until = min(len(prompt_ids), len(labels))
    for i in range(mask_until):
        labels[i] = -100

    return {
        "input_ids": input_ids,
        "attention_mask": full["attention_mask"],
        "labels": labels,
    }


def main():
    args = parse_args()

    tokenizer = build_tokenizer(args.model)

    raw = load_dataset(
        "json",
        data_files={"train": args.train, "validation": args.valid},
    )

    tokenized = raw.map(
        lambda ex: tokenize_and_mask(ex, tokenizer, args.max_len),
        remove_columns=raw["train"].column_names,
        desc="tokenizing",
    )

    model_kwargs = {"trust_remote_code": True, "device_map": "auto"}
    if args.four_bit:
        from transformers import BitsAndBytesConfig

        model_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
            bnb_4bit_use_double_quant=True,
            bnb_4bit_quant_type="nf4",
        )

    model = AutoModelForCausalLM.from_pretrained(args.model, **model_kwargs)
    model.config.use_cache = False

    if args.four_bit:
        model = prepare_model_for_kbit_training(model)

    lora = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=args.lora_dropout,
        bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)

    training_args = TrainingArguments(
        output_dir=args.out,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch,
        per_device_eval_batch_size=args.batch,
        gradient_accumulation_steps=args.grad_accum,
        learning_rate=args.lr,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        logging_steps=10,
        eval_strategy="epoch",
        save_strategy="epoch",
        save_total_limit=2,
        bf16=torch.cuda.is_available() and torch.cuda.is_bf16_supported(),
        fp16=torch.cuda.is_available() and not torch.cuda.is_bf16_supported(),
        report_to="none",
        gradient_checkpointing=True,
        optim="paged_adamw_8bit" if args.four_bit else "adamw_torch",
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized["train"],
        eval_dataset=tokenized["validation"],
        data_collator=collator,
    )

    trainer.train()
    trainer.save_model(args.out)
    tokenizer.save_pretrained(args.out)

    with open(os.path.join(args.out, "training_summary.json"), "w", encoding="utf-8") as f:
        json.dump(
            {
                "base_model": args.model,
                "train_records": len(tokenized["train"]),
                "valid_records": len(tokenized["validation"]),
                "epochs": args.epochs,
                "learning_rate": args.lr,
                "lora_r": args.lora_r,
                "lora_alpha": args.lora_alpha,
                "note": "Behaviour tuning only. Facts stay in retrieval.",
            },
            f,
            indent=2,
        )

    print("adapter saved to " + args.out)

    if args.merge:
        from peft import PeftModel

        print("merging adapter into the base model...")
        base = AutoModelForCausalLM.from_pretrained(args.model, torch_dtype=torch.float16, trust_remote_code=True)
        merged = PeftModel.from_pretrained(base, args.out)
        merged = merged.merge_and_unload()
        merged.save_pretrained(args.merged_out)
        tokenizer.save_pretrained(args.merged_out)
        print("merged model saved to " + args.merged_out)


if __name__ == "__main__":
    main()
