# Topics

The topic list this assistant is built around: 52 topics in six tiers. `data/topics.json` is
the same list in machine-readable form, so the app or a future version of it can read the
topics instead of hard-coding them.

**Status key**

| Status | Meaning |
| --- | --- |
| `live` | The knowledge base has data today, so the assistant answers it now. |
| `needs_data` | The topic is wanted but the facts are not stored yet. The assistant says so and points to the official page. It never invents a figure, date or cutoff. |
| `planned` | Later, or waiting on a decision. |

## Tier 1: admission core, live today (8 topics)

| Topic | Example questions |
| --- | --- |
| Programmes and duration | "LPU me kaun kaun se course hain?", "B.Tech kitne saal ka hai?" |
| Eligibility per programme | "B.Tech ke liye kya chahiye?", "MBA me fresher apply kar sakta hai?" |
| Admission process step by step | "Admission kaise le?", "Registration kaise karna hai?" |
| LPUNEST and entrance requirement | "LPUNEST compulsory hai?", "JEE Main se admission mil jayega?" |
| Scholarships and fee concessions | "Scholarship ke liye kya chahiye?", "78% par kitni scholarship milegi?" |
| Hostel, mess and transport | "Hostel me AC room milta hai?", "Transport facility hai?" |
| University basics and official links | "LPU kahan hai?", "Official website kya hai?" |
| Live status: admission open, session, notices | "Is admission open for 2026?", "Session kaunsa chal raha hai?" |

## Tier 2: high demand, data to add next (7 topics)

| Topic | Example questions |
| --- | --- |
| Fees: tuition, hostel, other charges | "B.Tech ki fees kitni hai?", "Semester wise fees batao" |
| Important dates and deadlines | "Last date kya hai?", "LPUNEST slot kab hai?" |
| Placements, packages and recruiters | "Average package kitna hai?", "CSE ka placement kaisa hai?" |
| Cutoff and selection criteria | "Cutoff kitna hai?", "Selection kaise hota hai?" |
| Contact, helpline and campus visit | "Helpline number kya hai?", "Counsellor se baat kaise karun?" |
| Documents checklist and application help | "Kaunse documents chahiye?", "Migration certificate zaroori hai?" |
| Refund and cancellation policy | "Admission cancel karne par fees wapas milegi?" |

## Tier 3: later (4 topics)

Programme comparison ("B.Tech CSE vs IT"), lateral entry and credit transfer, international
and NRI admission, campus life, clubs and sports.

## Tier 4: engineering concepts (4 topics)

This is the "what will I actually study" side of engineering, which a counsellor gets asked
constantly. All four need curriculum data before they can be answered properly.

| Topic | Example questions |
| --- | --- |
| Branch-wise subjects and labs | "B.Tech CSE me kya padhaya jata hai?", "First year me common subjects hote hain?" |
| Specialisations inside a branch | "CSE me AI/ML specialisation hai?", "Cyber security ka branch hai?" |
| Engineering fundamentals in the course | "Engineering drawing aati hai kya?", "Maths kitne semester tak hai?" |
| Projects, internships and training | "Internship college karwata hai?", "Final year project ka kya scene hai?" |

## Tier 5: coding concepts and logic (6 topics)

| Topic | Example questions |
| --- | --- |
| Coding from scratch | "Coding nahi aati, phir bhi CSE le sakta hoon?", "Zero se coding sikhate hain?" |
| Languages taught and when | "C, C++ padhate hain?", "Python kab start hoti hai?" |
| Logic building: DSA and problem solving | "DSA syllabus me hai?", "Logic building kaise hoti hai?" |
| Coding clubs, hackathons, contests | "Coding club hai?", "Hackathon hota hai?" |
| Coding in selection and placements | "LPUNEST me coding section hai?", "Placement me coding round hota hai?" |
| Concept answers (study mode) | "What is a loop?", "OOP samjhao", "DBMS basics batao" |

The last one is the only topic that is deliberately **not** live. The assistant is an
admission counsellor: it answers questions about LPU, and for anything else it says so
politely instead of turning into a general chatbot. Teaching engineering or coding concepts
would change that scope, so it waits for an explicit decision. Tier 4 and Tier 5 above are
about the *course* (what LPU teaches, in which semester, with which labs), which fits the
admission role and needs no scope change, only data.

## Tier 6: technical and AI concepts (23 topics)

The concepts the owner wants covered: RAG, SLM, architecture, API, REST API, Flask and the
rest of that world. These are the topics a student asking "yeh chatbot kaise kaam karta hai"
or "RAG kya hai" lands on, and they are also the stack this project itself runs on
(retrieval over a knowledge base, an API that verifies every answer, a static site with
serverless backend functions).

All 23 are `planned`: answering them means study mode, the one scope decision still open.
Listing them here makes the gap explicit instead of pretending the assistant covers them.

**AI and models**

| Topic | Example questions |
| --- | --- |
| LLM | "LLM kya hota hai?", "LLM kaise kaam karta hai?" |
| SLM (small language models) | "SLM kya hai?", "SLM aur LLM me kya farq hai?" |
| RAG (retrieval augmented generation) | "RAG kya hai?", "Is app me RAG use hua hai?" |
| Embeddings and vector search | "Embedding kya hoti hai?", "Vector database kya hai?" |
| Prompt engineering, context window | "Prompt engineering kya hai?", "Context window kya hai?" |
| Fine-tuning, training, inference | "Fine-tuning kya hai?", "Temperature kya karta hai?" |
| Hallucination and verification | "Hallucination kya hai?", "Answer verify kaise karte hain?" |

**Architecture**

| Topic | Example questions |
| --- | --- |
| System architecture, client and server | "System architecture kya hoti hai?", "3-tier architecture kya hai?" |
| Monolith, microservices, MVC | "Microservices kya hain?", "MVC pattern kya hai?" |
| Request flow: frontend to backend to database | "Browser se request kaise jaati hai?" |

**APIs**

| Topic | Example questions |
| --- | --- |
| API basics | "API kya hai?", "API kaise kaam karti hai?" |
| REST API: methods, endpoints, status codes | "REST API kya hai?", "GET aur POST me difference?" |
| Authentication and keys | "API key kya hoti hai?", "OAuth kya hai?" |
| Webhooks, JSON, rate limits | "Webhook kya hai?", "JSON kya hota hai?" |
| Calling and testing an API | "Postman me API kaise test karein?" |

**Web and backend**

| Topic | Example questions |
| --- | --- |
| Flask: routes, requests, responses | "Flask kya hai?", "Flask me route kaise banate hain?" |
| FastAPI, Django, Node/Express | "Flask aur Django me difference?", "FastAPI kab use karein?" |
| Frontend: HTML, CSS, JS, hosting | "Static site kya hoti hai?", "GitHub Pages par hosting kaise hoti hai?" |

**Data, deployment and coding logic**

| Topic | Example questions |
| --- | --- |
| Databases: SQL, NoSQL, caching | "SQL aur NoSQL me difference?", "Cache kyun use karte hain?" |
| Docker, CI/CD, serverless | "Docker kya hai?", "Serverless function kaise kaam karta hai?" |
| DSA and complexity | "Time complexity kaise nikalte hain?", "Recursion samjhao" |
| OOP and clean code | "OOP ke 4 pillars kya hain?", "Class aur object me difference?" |
| Debugging and error reading | "Stack trace kya hota hai?", "Error message kaise padhein?" |

## Adding data to a `needs_data` topic

1. Copy the facts from the official page (admission.lpu.in, lpu.in), never from memory.
2. Add them to `data/knowledge.json` under the matching section, with the source URL.
3. Keep amounts, percentages and dates exactly as the page shows them, so the verification
   layer can match them on the live page and stamp the answer as verified.
4. Flip the topic's `status` to `live` in `data/topics.json`.
