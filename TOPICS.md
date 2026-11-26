# Topics

The topic list this assistant is built around. `data/topics.json` is the same list in
machine-readable form, so the app or a future version of it can read the topics instead of
hard-coding them.

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

## Adding data to a `needs_data` topic

1. Copy the facts from the official page (admission.lpu.in, lpu.in), never from memory.
2. Add them to `data/knowledge.json` under the matching section, with the source URL.
3. Keep amounts, percentages and dates exactly as the page shows them, so the verification
   layer can match them on the live page and stamp the answer as verified.
4. Flip the topic's `status` to `live` in `data/topics.json`.
