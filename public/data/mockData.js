// Velite QA-Nexus Mock Database
// This data layer is designed for maximum flexibility, allowing the QA/QC/Production teams to edit, append, and override values.

const initialDocuments = [
  {
    id: "SOP-QA-001",
    title: "Line Clearance and Cleaning Verification Procedure",
    category: "SOP",
    department: "Quality Assurance",
    version: "2.4",
    status: "Approved",
    effectiveDate: "2024-06-15",
    renewalDate: "2026-06-15",
    owner: "Sanjiv Kumar Verma",
    wordFile: "SOP-QA-001_v2.4.docx",
    pdfFile: "SOP-QA-001_v2.4_Signed.pdf",
    history: [
      { version: "1.0", date: "2021-06-15", author: "R. Sharma", changes: "Initial release" },
      { version: "2.0", date: "2023-05-10", author: "A. Patel", changes: "Updated for new high-shear mixer clean-down" },
      { version: "2.4", date: "2024-06-15", author: "Sanjiv Kumar Verma", changes: "Minor correction in rinse water conductivity levels" }
    ]
  },
  {
    id: "SOP-PROD-012",
    title: "Operation and Calibration of Double Cone Blender",
    category: "SOP",
    department: "Production",
    version: "1.0",
    status: "Approved",
    effectiveDate: "2024-04-01",
    renewalDate: "2026-07-20", // Expiring soon
    owner: "Vikram Sen",
    wordFile: "SOP-PROD-012_v1.0.docx",
    pdfFile: "SOP-PROD-012_v1.0_Signed.pdf",
    history: [
      { version: "1.0", date: "2024-04-01", author: "Vikram Sen", changes: "Initial operating protocol setup" }
    ]
  },
  {
    id: "SPEC-QC-088",
    title: "Analytical Testing Specification for Purified Water",
    category: "Specification",
    department: "Quality Control",
    version: "3.1",
    status: "Under Revision",
    effectiveDate: "2023-01-10",
    renewalDate: "2025-01-10", // Overdue (Red)
    owner: "Dr. Nivedita Rao",
    wordFile: "SPEC-QC-088_v3.1.docx",
    pdfFile: null,
    history: [
      { version: "1.0", date: "2020-01-10", author: "Dr. Nivedita Rao", changes: "Initial setup" },
      { version: "3.0", date: "2022-12-15", author: "Dr. Nivedita Rao", changes: "Aligned with USP/IP pharmacopeia updates" },
      { version: "3.1", date: "2023-01-10", author: "Dr. Nivedita Rao", changes: "Formatting fixes" }
    ]
  },
  {
    id: "SOP-QA-015",
    title: "Management of Out-of-Specification (OOS) Results",
    category: "SOP",
    department: "Quality Assurance",
    version: "4.0",
    status: "Approved",
    effectiveDate: "2024-08-20",
    renewalDate: "2026-08-20",
    owner: "Sanjiv Kumar Verma",
    wordFile: "SOP-QA-015_v4.0.docx",
    pdfFile: "SOP-QA-015_v4.0_Signed.pdf",
    history: [
      { version: "4.0", date: "2024-08-20", author: "Sanjiv Kumar Verma", changes: "Complete revision to align with latest FDA guidance on OOS" }
    ]
  },
  {
    id: "SOP-COSM-004",
    title: "Sensory Panel Assessment of External Emulsions",
    category: "SOP",
    department: "Quality Assurance",
    version: "1.2",
    status: "Draft",
    effectiveDate: "2025-09-01",
    renewalDate: "2026-06-05", // Expiring soon
    owner: "Ananya Mehta",
    wordFile: "SOP-COSM-004_Draft.docx",
    pdfFile: null,
    history: [
      { version: "1.0", date: "2024-09-01", author: "Ananya Mehta", changes: "Draft created for review" },
      { version: "1.2", date: "2025-09-01", author: "Ananya Mehta", changes: "Incorporated feedback from marketing sensory panel" }
    ]
  },
  {
    id: "FORM-QC-102",
    title: "Stability Testing Protocol for Skin Hydrating Creams",
    category: "Policy",
    department: "Quality Control",
    version: "2.0",
    status: "Approved",
    effectiveDate: "2023-03-10",
    renewalDate: "2025-03-10", // Overdue (Red)
    owner: "Dr. Nivedita Rao",
    wordFile: "FORM-QC-102_v2.0.docx",
    pdfFile: "FORM-QC-102_v2.0_Signed.pdf",
    history: [
      { version: "2.0", date: "2023-03-10", author: "Dr. Nivedita Rao", changes: "Updated temperature range parameters" }
    ]
  }
];

const initialDeviations = [
  {
    id: "DEV-2026-004",
    title: "Temperature excursion in Incubator QC-INC-03 during stability study",
    batchNo: "VH-SHC-602",
    severity: "Major",
    dateLogged: "2026-05-10",
    description: "Incubator temperature rose to 49°C for a continuous duration of 4.5 hours due to a faulty thermostat board. The protocol limits are 45°C ± 2°C.",
    status: "CAPA Assigned",
    trained: false,
    rca: {
      framework: "5whys",
      details: "1. Why did the temperature rise? Thermostat contact relay remained closed.\n2. Why did it remain closed? High humidity caused localized corrosion on the contact plates.\n3. Why was there high humidity? The incubator chamber seal was cracked.\n4. Why was the seal cracked? The seal had exceeded its preventive maintenance lifetime of 12 months.\n5. Why was it overdue? The maintenance schedule was managed on a manual whiteboard and missed."
    },
    capa: {
      action: "Replace thermostat board and chamber seal immediately. Establish a digitized preventative maintenance log inside QA-Nexus to automate scheduling alerts.",
      assignee: "Vikram Sen",
      dueDate: "2026-06-10",
      verificationStatus: "Pending Verification"
    }
  },
  {
    id: "DEV-2026-005",
    title: "Bulk mixing speed deviation during ointment batch manufacture",
    batchNo: "VP-BT-409",
    severity: "Minor",
    dateLogged: "2026-05-18",
    description: "During the compounding of Betamethasone Ointment, the mixing speed dropped to 800 RPM for 15 minutes due to a momentary electrical voltage sag. The required speed is 1000 ± 50 RPM.",
    status: "Closed",
    trained: true,
    rca: {
      framework: "fishbone",
      details: "Category: Machine. Detail: Voltage drop in manufacturing block feeder. Product viscosity and consistency checked by QC and found completely within specifications. No impact on final product quality."
    },
    capa: {
      action: "Log deviation. QC sensory and particle size testing cleared. Batch deemed fit for release.",
      assignee: "Sanjiv Kumar Verma",
      dueDate: "2026-05-20",
      verificationStatus: "Verified & Closed"
    }
  }
];

const initialStabilityStudies = [
  {
    id: "STAB-2026-01",
    productName: "Velite Glow Serum (Gold Edition)",
    batchNo: "VH-VGS-501",
    startDate: "2026-02-15",
    conditions: [
      { temp: "4°C", m1: "Pass", m2: "Pass", m3: "Pass", m6: "Pending" },
      { temp: "Room Temp (25°C)", m1: "Pass", m2: "Pass", m3: "Pass", m6: "Pending" },
      { temp: "37°C", m1: "Pass", m2: "Pass", m3: "Pass", m6: "Pending" },
      { temp: "45°C / 75% RH", m1: "Pass", m2: "Pass", m3: "Slight Color Fade", m6: "Pending" }
    ],
    status: "Ongoing",
    activeInterval: "3M Checked"
  },
  {
    id: "STAB-2025-08",
    productName: "Anti-Ageing Botanical Cream",
    batchNo: "VH-ABC-102",
    startDate: "2025-11-20",
    conditions: [
      { temp: "4°C", m1: "Pass", m2: "Pass", m3: "Pass", m6: "Pass" },
      { temp: "Room Temp (25°C)", m1: "Pass", m2: "Pass", m3: "Pass", m6: "Pass" },
      { temp: "37°C", m1: "Pass", m2: "Pass", m3: "Pass", m6: "Slight Viscosity Drop" },
      { temp: "45°C / 75% RH", m1: "Pass", m2: "Pass", m3: "Phase Separation", m6: "Failed" }
    ],
    status: "Completed",
    activeInterval: "Completed"
  }
];

const initialBatches = [
  {
    batchNo: "VP-BT-409",
    productName: "Betamethasone Dipropionate Ointment (Drugs)",
    mfgDate: "2026-05-10",
    expDate: "2028-05-09",
    division: "Pharmaceuticals",
    status: "Quarantined",
    
    // --- PRODUCTION LOGS ---
    lineClearance: { requested: true, approved: true, approvedBy: "Sanjiv Kumar Verma", timestamp: "2026-05-10 09:30" },
    compoundingLogged: true,
    productionCPP: {
      temp: "42.5°C (Target: 40-45°C)",
      mixingSpeed: "800-1000 RPM (Target: 1000 ± 50)",
      mixingTime: "45 mins (Target: 45 mins)",
      operator: "Vikram Sen"
    },
    handoverToQc: true,
    
    // --- QC LAB RESULTS ---
    qcStatus: "Passed",
    tests: {
      pH: 5.6,
      assay: "99.2% (Limits: 95.0% - 105.0%)",
      viscosity: "42,000 cps",
      microbial: "Cleared"
    },
    qcMicrobial: {
      tamc: "12 CFU/g (Limit: <= 100 CFU/g)",
      tymc: "2 CFU/g (Limit: <= 10 CFU/g)",
      pathogens: "Pseudomonas, E.coli: Negative"
    },
    qcAllergens: [],
    coaDrafted: true,

    records: {
      rawMaterialChecked: true,
      compoundingLogged: true,
      packagingCleared: false,
      microbiologicalTesting: "Cleared",
      analyticalTesting: "Passed"
    }
  },
  {
    batchNo: "VH-SHC-602",
    productName: "Ultra-Hydrating Cocoa Butter Cream (Cosmetics)",
    mfgDate: "2026-05-12",
    expDate: "2029-05-11",
    division: "Healthcare",
    status: "Ready for Sensory QC",
    
    // --- PRODUCTION LOGS ---
    lineClearance: { requested: true, approved: true, approvedBy: "Sanjiv Kumar Verma", timestamp: "2026-05-12 08:15" },
    compoundingLogged: true,
    productionCPP: {
      temp: "68.2°C (Target: 65-70°C)",
      mixingSpeed: "1200 RPM (Target: 1200 ± 100)",
      mixingTime: "60 mins (Target: 60 mins)",
      operator: "Ramesh Kumar"
    },
    handoverToQc: true,

    // --- QC LAB RESULTS ---
    qcStatus: "Pending", // Sensory checking pending
    tests: {
      pH: 6.2,
      viscosity: "28,500 cps",
      specificGravity: 0.98,
      appearance: 5, // scale 1-5
      fragrance: 5,
      skinFeel: 4,
      absorption: 4
    },
    qcMicrobial: {
      tamc: "Pending",
      tymc: "Pending",
      pathogens: "Awaiting incubation"
    },
    qcAllergens: ["Butylphenyl Methylpropional"], // Trigger allergen warning alert
    coaDrafted: false,

    records: {
      rawMaterialChecked: true,
      compoundingLogged: true,
      packagingCleared: true,
      microbiologicalTesting: "Ongoing",
      analyticalTesting: "Passed"
    }
  }
];

// Cosmetic Ingredient Checker Database
const ingredientDatabase = [
  { name: "Butylphenyl Methylpropional", synonym: "Lilial", status: "Banned", region: "EU/UK", reason: "Reproductive toxicity, endocrine disruption." },
  { name: "Formaldehyde", synonym: "Formalin", status: "Banned", region: "EU/India/UK", reason: "Known human carcinogen, skin sensitizer." },
  { name: "Isobutylparaben", synonym: "Paraben", status: "Banned", region: "EU/UK", reason: "Endocrine disrupting potential." },
  { name: "Isopropylparaben", synonym: "Paraben", status: "Banned", region: "EU/UK", reason: "Endocrine disrupting potential." },
  { name: "Triclosan", synonym: "Triclosan", status: "Restricted", region: "Global", reason: "Limit of 0.3% in creams and toothpastes. Thyroid hormone disruptor." },
  { name: "BHA", synonym: "Butylated Hydroxyanisole", status: "Restricted", region: "EU", reason: "Potential endocrine disruptor. Allowed up to 0.02%." },
  { name: "Coal Tar", synonym: "CI 75810", status: "Banned", region: "US/EU", reason: "Carcinogenicity. Banned in cosmetics." },
  { name: "Hydroquinone", synonym: "Hydroquinone", status: "Banned", region: "EU/UK (OTC)", reason: "Banned in consumer cosmetics, prescription only. Skin bleaching toxicity." }
];

// Regulatory Allergens Database (26 Substances requiring labeling)
const allergensDatabase = [
  { name: "Amyl Cinnamal", code: "AC-101", risk: "Moderate Sensitizer", threshold: "0.001% in leave-on, 0.01% in rinse-off" },
  { name: "Benzyl Alcohol", code: "BA-102", risk: "Mild Sensitizer / Preservative", threshold: "1.0% max concentration" },
  { name: "Cinnamyl Alcohol", code: "CA-103", risk: "High Sensitizer", threshold: "0.001% limit" },
  { name: "Citral", code: "CI-104", risk: "Moderate Sensitizer / Citrus allergen", threshold: "0.001% limit" },
  { name: "Eugenol", code: "EU-105", risk: "Strong Sensitizer / Clove derivative", threshold: "0.001% limit" },
  { name: "Geraniol", code: "GE-106", risk: "Mild Sensitizer / Rose oil derivative", threshold: "0.001% limit" },
  { name: "Hydroxycitronellal", code: "HC-107", risk: "High Sensitizer", threshold: "0.001% limit" },
  { name: "Isoeugenol", code: "IE-108", risk: "Extremely High Sensitizer", threshold: "0.0002% strict limit" },
  { name: "Coumarin", code: "CO-109", risk: "Moderate Allergen / Tonka bean", threshold: "0.001% limit" },
  { name: "Limonene", code: "LM-110", risk: "Citrus Allergen / Oxidizes on skin", threshold: "0.001% limit" },
  { name: "Linalool", code: "LN-111", risk: "Lavender Allergen / Oxidizes on skin", threshold: "0.001% limit" },
  { name: "Butylphenyl Methylpropional", code: "BM-112", risk: "Banned / Reproductive Allergen", threshold: "0.00% STRICTLY PROHIBITED" }
];

// Seed Multi-User Credentials for Gmail Login Simulation
const initialUsers = [
  {
    email: "sanjiv.verma@velite.com",
    name: "Sanjiv Kumar Verma",
    role: "CEO",
    department: "Executive",
    avatar: "SV",
    division: "global"
  },
  // QA staff who function under QA but are granted Executive-tier rights.
  // Access is decided by `department`, not `role`: department === "Executive"
  // grants full access and the hat switcher. The role label below is display
  // only and reflects their actual QA position.
  {
    email: "satwinder@velite.com",
    name: "Satwinder",
    role: "QA Head",
    department: "Executive",
    avatar: "SW",
    division: "global"
  },
  {
    // Replaced Ramna (ramna@velite.com), who left in Oct 2026.
    email: "qualityassurance1.velite@gmail.com",
    name: "Ritika",
    role: "QA Officer",
    department: "Executive",
    avatar: "RI",
    division: "global"
  },
  {
    email: "qc.velite@gmail.com",
    name: "Sachin",
    role: "Analyst",
    department: "Quality Control",
    avatar: "SC",
    division: "global"
  },
  {
    email: "micro.velite@gmail.com",
    name: "Rajeev",
    role: "Microbiologist",
    department: "Quality Control",
    avatar: "RJ",
    division: "global"
  },
  {
    email: "production2.velite@gmail.com",
    name: "Surbhi",
    role: "Officer",
    department: "Production",
    avatar: "SU",
    division: "global"
  },
  {
    // HR uploads its own department's documents and sees only those.
    email: "gursingh.velite@gmail.com",
    name: "Pawan",
    role: "HR Officer",
    department: "HR",
    avatar: "PW",
    division: "global"
  }
];

// Seed AI Knowledge Base (Historical RCA models representing auto-learned rules)
const initialAiKnowledge = [
  {
    id: "KB-001",
    issueType: "Temperature excursion",
    category: "Equipment / Machine",
    rootCause: "Faulty thermostat relay and crack in chamber door gaskets. High humidity over-corroded electrical contact plates.",
    capa: "Establish scheduled preventive maintenance logs and replace thermostat relays every 12 months.",
    approvedBy: "Sanjiv Kumar Verma",
    timestamp: "2026-05-15"
  },
  {
    id: "KB-002",
    issueType: "Viscosity drop",
    category: "Process / Method",
    rootCause: "Insufficient emulsification time during compound cooling phase under shear.",
    capa: "Update standard operating procedures to mandate cooling temperature ranges before high-shear agitation finishes.",
    approvedBy: "Sanjiv Kumar Verma",
    timestamp: "2026-05-18"
  }
];

// ★ BACKEND-MANAGED MODE GUARD
// If backend-adapter.js has loaded (sets window.__VELITE_DEVICE_ID), the app
// is backend-managed and gets its data from Drive via /api/data/pull.
// SKIP mock-data seeding entirely — otherwise these 6 demo SOPs would be
// pushed to Drive via auto-sync and OVERWRITE the real 199 SOPs.
// Only users (velite_users) always get seeded so the login picker works
// on the very first load before Drive pulls the real user list.
const _VELITE_BACKEND_MODE = !!window.__VELITE_DEVICE_ID;

if (!_VELITE_BACKEND_MODE) {
  // Legacy standalone / Vercel mode — seed as before.
  if (!localStorage.getItem("velite_documents")) {
    localStorage.setItem("velite_documents", JSON.stringify(initialDocuments));
  }
  if (!localStorage.getItem("velite_deviations")) {
    localStorage.setItem("velite_deviations", JSON.stringify(initialDeviations));
  }
  if (!localStorage.getItem("velite_stability")) {
    localStorage.setItem("velite_stability", JSON.stringify(initialStabilityStudies));
  }
  if (!localStorage.getItem("velite_batches")) {
    localStorage.setItem("velite_batches", JSON.stringify(initialBatches));
  }
} else {
  console.log("[mockData] Backend-managed mode — mock docs/deviations/stability/batches NOT seeded (will be pulled from Drive).");
}
if (!localStorage.getItem("velite_users")) {
  localStorage.setItem("velite_users", JSON.stringify(initialUsers));
} else {
  // Reconcile the sign-in roster against initialUsers above, which is the single
  // source of truth for who may use the app. There is no UI for managing users,
  // so staff changes are made by editing that list and deploying.
  //
  // This replaced an append-only migration that could add people but never
  // rename or remove them, so someone who had left stayed on the sign-in screen
  // on every browser that had already seeded.
  //
  // Reconciling means: add anyone missing, update the details of anyone whose
  // email already exists, and drop anyone no longer on the list. Matching is by
  // email, case-insensitively. Removing someone only takes them off the sign-in
  // screen — their name stays on every audit-log entry and document they
  // authored, which is what a GMP record requires.
  try {
    const seeds = initialUsers;
    // Guard against wiping the roster if the seed list is ever truncated by a
    // bad edit or a partial file load.
    if (!Array.isArray(seeds) || seeds.length < 3) {
      throw new Error(`seed roster looks wrong (${seeds && seeds.length} entries) — leaving velite_users alone`);
    }
    // A corrupt or non-array value must not be left in place: getUsers() would
    // hand it to the sign-in screen, which throws while rendering and leaves the
    // sign-in button doing nothing. Treat anything unreadable as empty and let
    // the seeds below rewrite it.
    let existing = [];
    try {
      const parsed = JSON.parse(localStorage.getItem("velite_users"));
      if (Array.isArray(parsed)) existing = parsed.filter(u => u && typeof u === "object");
      else console.warn("[Velite] velite_users was not an array — rebuilding from the roster.");
    } catch (_) {
      console.warn("[Velite] velite_users was unreadable — rebuilding from the roster.");
    }
    const byEmail = new Map(existing.map(u => [(u.email || "").toLowerCase(), u]));
    const seedEmails = new Set(seeds.map(u => (u.email || "").toLowerCase()));

    const added = [], updated = [], removed = [];
    for (const seed of seeds) {
      const key = (seed.email || "").toLowerCase();
      const prev = byEmail.get(key);
      if (!prev) { added.push(seed.name); continue; }
      if (JSON.stringify({ ...prev, ...seed }) !== JSON.stringify(prev)) updated.push(seed.name);
    }
    for (const u of existing) {
      if (!seedEmails.has((u.email || "").toLowerCase())) removed.push(u.name || u.email);
    }

    if (added.length || updated.length || removed.length) {
      // Seed values win on every field, so a rename or a department change takes
      // effect rather than being silently kept at the old value.
      const reconciled = seeds.map(seed => ({
        ...(byEmail.get((seed.email || "").toLowerCase()) || {}),
        ...seed
      }));
      localStorage.setItem("velite_users", JSON.stringify(reconciled));
      console.log(
        `[Velite] Sign-in roster reconciled — added: [${added}], updated: [${updated}], removed: [${removed}].`
      );
      // Leave a trail in the audit log; a roster change is a controlled change.
      try {
        const logs = JSON.parse(localStorage.getItem("velite_audit_logs") || "[]");
        logs.unshift({
          timestamp: new Date().toLocaleString(),
          user: "System",
          action: `Sign-in roster reconciled to the deployed list. Added: ${added.join(", ") || "none"}. ` +
                  `Updated: ${updated.join(", ") || "none"}. Removed from sign-in: ${removed.join(", ") || "none"}. ` +
                  `Historical audit entries and document authorship are unchanged.`,
          division: "System"
        });
        localStorage.setItem("velite_audit_logs", JSON.stringify(logs));
      } catch (_) { /* the roster change itself must not fail on a log write */ }
    }
  } catch (e) {
    console.warn("[Velite] User roster reconcile skipped:", e.message || e);
  }
}
if (!localStorage.getItem("velite_ai_knowledge")) {
  localStorage.setItem("velite_ai_knowledge", JSON.stringify(initialAiKnowledge));
}

// Helper methods to read/write state easily
const db = {
  getDocuments: () => JSON.parse(localStorage.getItem("velite_documents")),
  saveDocuments: (docs) => localStorage.setItem("velite_documents", JSON.stringify(docs)),
  
  getDeviations: () => JSON.parse(localStorage.getItem("velite_deviations")),
  saveDeviations: (devs) => localStorage.setItem("velite_deviations", JSON.stringify(devs)),
  
  getStability: () => JSON.parse(localStorage.getItem("velite_stability")),
  saveStability: (stab) => localStorage.setItem("velite_stability", JSON.stringify(stab)),
  
  getBatches: () => JSON.parse(localStorage.getItem("velite_batches")),
  saveBatches: (batches) => localStorage.setItem("velite_batches", JSON.stringify(batches)),
  
  getUsers: () => JSON.parse(localStorage.getItem("velite_users")),
  saveUsers: (users) => localStorage.setItem("velite_users", JSON.stringify(users)),

  getAiKnowledge: () => JSON.parse(localStorage.getItem("velite_ai_knowledge")),
  saveAiKnowledge: (kb) => localStorage.setItem("velite_ai_knowledge", JSON.stringify(kb)),

  getIngredientDB: () => ingredientDatabase,
  getAllergensDB: () => allergensDatabase,
  
  addAuditLog: (user, action, division) => {
    const logs = JSON.parse(localStorage.getItem("velite_audit_logs") || "[]");
    logs.unshift({
      timestamp: new Date().toLocaleString(),
      user: user || "Sanjiv Kumar Verma",
      action: action,
      division: division || "Global"
    });
    localStorage.setItem("velite_audit_logs", JSON.stringify(logs));
  },
  
  getAuditLogs: () => JSON.parse(localStorage.getItem("velite_audit_logs") || "[]")
};

// Seed audit logs
if (db.getAuditLogs().length === 0) {
  db.addAuditLog("System", "QA-Nexus system initialized and database seeded", "Global");
  db.addAuditLog("System", "Seeded multi-user Google accounts & AI Knowledge vectorbase", "Global");
}
