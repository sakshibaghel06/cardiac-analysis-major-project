/*
=====================================================================
PRESCRIPTION PDF  -  generation test
=====================================================================

Builds a PDF from a realistic prescription record and checks the
result is a real, non-trivial, multi-section document.

Run:  node scripts/test_prescription_pdf.mjs

Writes the PDF so it can also be opened and looked at - a byte-count
assertion proves the generator ran, not that the page is legible.
=====================================================================
*/

import { writeFileSync } from "node:fs";

import {
  buildPrescriptionPdf,
  prescriptionFileName,
} from "../src/services/prescriptionPdf.js";

let passed = 0;
let failed = 0;

const check = (name, condition, detail = "") => {
  if (condition) {
    console.log(`  PASS  ${name}`);
    passed += 1;
  } else {
    console.log(`  FAIL  ${name}${detail ? ` - ${detail}` : ""}`);
    failed += 1;
  }
};

// A Firestore Timestamp exposes toDate(); mimic that here so the
// generator is exercised through the same path the app uses.
const timestamp = (date) => ({ toDate: () => date });

const prescription = {
  id: "rx_8Kd92mXqLp",
  requestId: "req_Zm4TbN7wQs",
  patientId: "patient_abc",
  patientName: "Anjali Verma",

  doctorId: "doctor_xyz",
  doctorName: "Dr. Ananya Sharma",
  doctorSpecialization: "Cardiologist",
  doctorHospital: "CardioCare Medical Center",
  doctorEmail: "ananya.sharma@example.com",

  diagnosis:
    "Moderate estimated cardiovascular risk on screening. Reports chest " +
    "tightness on exertion relieved by rest. No acute distress on " +
    "examination. Advised further evaluation.",

  medicines: [
    {
      name: "Atorvastatin",
      dosage: "10 mg",
      frequency: "Once daily at night",
      duration: "30 days",
      instructions: "After food",
    },
    {
      name: "Aspirin",
      dosage: "75 mg",
      frequency: "Once daily",
      duration: "30 days",
      instructions: "After breakfast. Stop and contact me if any bleeding.",
    },
    {
      name: "Metoprolol",
      dosage: "25 mg",
      frequency: "Twice daily",
      duration: "14 days",
      instructions: "",
    },
  ],

  notes:
    "Discussed lifestyle measures: reduce salt, 30 minutes brisk walking " +
    "five days a week, stop smoking. Explained that the screening result " +
    "is an estimate and not a diagnosis.",

  followUp:
    "Review in 4 weeks with a repeat lipid profile. Attend urgently if " +
    "chest pain occurs at rest, lasts more than a few minutes, or is " +
    "accompanied by breathlessness.",

  createdAt: timestamp(new Date("2026-10-22T10:30:00Z")),
};

const consultation = {
  id: "req_Zm4TbN7wQs",
  patientName: "Anjali Verma",
  patientEmail: "anjali.verma@example.com",
  doctorName: "Dr. Ananya Sharma",
};

console.log("=".repeat(62));
console.log("PRESCRIPTION PDF GENERATION");
console.log("=".repeat(62));

// ---------------------------------------------------------------
// 1. FULL RECORD
// ---------------------------------------------------------------

console.log("\n--- full prescription ---");

const doc = buildPrescriptionPdf({ prescription, consultation });
const bytes = new Uint8Array(doc.output("arraybuffer"));

check("produces output", bytes.length > 0);

const magic = String.fromCharCode(...bytes.slice(0, 5));
check("is a real PDF file", magic === "%PDF-", `header was "${magic}"`);

check(
  "is a substantial document, not an empty page",
  bytes.length > 3000,
  `${bytes.length} bytes`
);

check("single page for this content", doc.getNumberOfPages() === 1,
  `${doc.getNumberOfPages()} pages`);

/*
  The medicines table is drawn by autoTable, which records where it
  finished. If that is missing the table never rendered.
*/
check(
  "medicines table rendered",
  typeof doc.lastAutoTable?.finalY === "number" && doc.lastAutoTable.finalY > 0,
  `finalY=${doc.lastAutoTable?.finalY}`
);

check(
  "table finished above the footer",
  doc.lastAutoTable.finalY < 276,
  `finalY=${doc.lastAutoTable?.finalY}`
);

// ---------------------------------------------------------------
// 2. FILENAME
// ---------------------------------------------------------------

console.log("\n--- filename ---");

const name = prescriptionFileName(prescription);

check("includes patient name", name.includes("anjali-verma"), name);
check("includes issue date", name.includes("2026-10-22"), name);
check("ends with .pdf", name.endsWith(".pdf"), name);
check(
  "no characters that break a download",
  /^[a-z0-9._-]+$/.test(name),
  name
);

// ---------------------------------------------------------------
// 3. EDGE CASES  -  must not throw
// ---------------------------------------------------------------

console.log("\n--- edge cases ---");

const minimal = {
  id: "rx_min",
  requestId: "req_min",
  patientName: "",
  doctorEmail: "doc@example.com",
  diagnosis: "Follow-up consultation.",
  medicines: [],
  createdAt: timestamp(new Date("2026-10-22T10:30:00Z")),
};

try {
  const bare = buildPrescriptionPdf({ prescription: minimal });

  check("no medicines, no consultation record", true);
  check(
    "still a valid PDF",
    String.fromCharCode(
      ...new Uint8Array(bare.output("arraybuffer")).slice(0, 5)
    ) === "%PDF-"
  );
  check(
    "missing patient name falls back in the filename",
    prescriptionFileName(minimal).startsWith("prescription-patient-")
  );
} catch (error) {
  check("no medicines, no consultation record", false, error.message);
}

// A long prescription must flow onto a second page, not off the first.
try {
  const long = {
    ...prescription,
    medicines: Array.from({ length: 22 }, (_, index) => ({
      name: `Medicine ${index + 1}`,
      dosage: "10 mg",
      frequency: "Twice daily",
      duration: "30 days",
      instructions: "Take after food with a full glass of water.",
    })),
  };

  const longDoc = buildPrescriptionPdf({ prescription: long, consultation });

  check(
    "22 medicines paginate onto multiple pages",
    longDoc.getNumberOfPages() > 1,
    `${longDoc.getNumberOfPages()} pages`
  );

  writeFileSync(
    "scripts/sample-prescription-long.pdf",
    Buffer.from(longDoc.output("arraybuffer"))
  );
} catch (error) {
  check("22 medicines paginate onto multiple pages", false, error.message);
}

// ---------------------------------------------------------------

writeFileSync(
  "scripts/sample-prescription.pdf",
  Buffer.from(bytes)
);

console.log("\n" + "=".repeat(62));
console.log(`PASSED: ${passed}    FAILED: ${failed}`);
console.log(`Wrote scripts/sample-prescription.pdf (${bytes.length} bytes)`);
console.log("=".repeat(62));

process.exit(failed === 0 ? 0 : 1);
