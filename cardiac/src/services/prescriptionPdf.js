import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/*
=====================================================
PRESCRIPTION PDF
=====================================================

Renders an issued prescription as a downloadable A4 PDF.

Generated entirely in the browser, deliberately:

  * the file is never uploaded anywhere, so there is no
    public URL for a private medical document to leak
    through
  * it is built from the Firestore record the patient is
    already authorised to read, so the PDF can never show
    more than they may already see

Everything on the page was typed by the doctor. Nothing
here infers, suggests or completes clinical content.
=====================================================
*/

// A restrained print palette. Saturated colours cost ink
// and read badly on a monochrome printer.
const INK = [18, 56, 90];
const MUTED = [120, 148, 174];
const LINE = [214, 227, 238];
const ACCENT = [42, 167, 196];

const MARGIN = 16;
const PAGE_WIDTH = 210;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

const formatDate = (value) => {
  if (!value) return "-";

  const date =
    typeof value.toDate === "function" ? value.toDate() : new Date(value);

  if (Number.isNaN(date.getTime())) return "-";

  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const safe = (value, fallback = "-") => {
  const text = (value ?? "").toString().trim();
  return text.length > 0 ? text : fallback;
};

/*
Draws a labelled block of key/value lines and returns the
y position just below it, so sections can stack without
each one hard-coding its own offsets.
*/
const drawDetailBlock = (doc, { x, y, width, title, rows }) => {
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.setFont("helvetica", "bold");
  doc.text(title.toUpperCase(), x, y);

  let cursor = y + 5;

  rows.forEach(([label, value]) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);
    doc.setTextColor(...MUTED);
    doc.text(`${label}`, x, cursor);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...INK);

    // Wrap rather than overflow into the neighbouring column.
    const lines = doc.splitTextToSize(safe(value), width - 26);
    doc.text(lines, x + 26, cursor);

    cursor += 4.6 * lines.length;
  });

  return cursor;
};

const drawSection = (doc, { y, title, body }) => {
  if (!body || !body.trim()) return y;

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...MUTED);
  doc.text(title.toUpperCase(), MARGIN, y);

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...INK);

  const lines = doc.splitTextToSize(body.trim(), CONTENT_WIDTH);
  doc.text(lines, MARGIN, y + 5.5);

  return y + 5.5 + lines.length * 4.8 + 6;
};

/*
Builds the document. Returns the jsPDF instance so callers
can download it, open it in a tab, or test it without
touching the filesystem.
*/
export const buildPrescriptionPdf = ({ prescription, consultation }) => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // ---------------------------------------------------
  // HEADER
  // ---------------------------------------------------

  doc.setFillColor(...ACCENT);
  doc.rect(0, 0, PAGE_WIDTH, 3, "F");

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.setTextColor(...INK);
  doc.text("CardioCare", MARGIN, 18);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...MUTED);
  doc.text("Cardiac screening and teleconsultation", MARGIN, 23);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text("PRESCRIPTION", PAGE_WIDTH - MARGIN, 18, { align: "right" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(
    `Issued ${formatDate(prescription.createdAt)}`,
    PAGE_WIDTH - MARGIN,
    23,
    { align: "right" }
  );

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, 28, PAGE_WIDTH - MARGIN, 28);

  // ---------------------------------------------------
  // PATIENT  /  DOCTOR
  // ---------------------------------------------------

  const columnWidth = CONTENT_WIDTH / 2 - 4;

  const patientBottom = drawDetailBlock(doc, {
    x: MARGIN,
    y: 36,
    width: columnWidth,
    title: "Patient",
    rows: [
      ["Name", prescription.patientName || consultation?.patientName],
      ["Email", consultation?.patientEmail],
    ],
  });

  const doctorBottom = drawDetailBlock(doc, {
    x: MARGIN + columnWidth + 8,
    y: 36,
    width: columnWidth,
    title: "Prescribing doctor",
    rows: [
      ["Name", prescription.doctorName || consultation?.doctorName],
      ["Speciality", prescription.doctorSpecialization],
      ["Hospital", prescription.doctorHospital],
      ["Email", prescription.doctorEmail],
    ],
  });

  let y = Math.max(patientBottom, doctorBottom) + 4;

  // ---------------------------------------------------
  // REFERENCES
  // ---------------------------------------------------

  doc.setDrawColor(...LINE);
  doc.line(MARGIN, y, PAGE_WIDTH - MARGIN, y);
  y += 6;

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(...MUTED);
  doc.text(
    `Consultation ref: ${safe(prescription.requestId)}`,
    MARGIN,
    y
  );
  doc.text(
    `Prescription ref: ${safe(prescription.id)}`,
    PAGE_WIDTH - MARGIN,
    y,
    { align: "right" }
  );

  y += 10;

  // ---------------------------------------------------
  // DIAGNOSIS
  // ---------------------------------------------------

  y = drawSection(doc, {
    y,
    title: "Diagnosis / clinical note",
    body: prescription.diagnosis,
  });

  // ---------------------------------------------------
  // MEDICINES
  // ---------------------------------------------------

  const medicines = prescription.medicines || [];

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(...MUTED);
  doc.text("MEDICINES", MARGIN, y);

  y += 3;

  if (medicines.length === 0) {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(9.5);
    doc.setTextColor(...MUTED);
    doc.text("No medicines were prescribed.", MARGIN, y + 5);

    y += 12;
  } else {
    autoTable(doc, {
      startY: y,
      margin: { left: MARGIN, right: MARGIN },
      head: [["#", "Medicine", "Dosage", "Frequency", "Duration", "Instructions"]],
      body: medicines.map((medicine, index) => [
        index + 1,
        safe(medicine.name),
        safe(medicine.dosage),
        safe(medicine.frequency),
        safe(medicine.duration),
        safe(medicine.instructions, ""),
      ]),
      styles: {
        font: "helvetica",
        fontSize: 9,
        cellPadding: 2.6,
        textColor: INK,
        lineColor: LINE,
        lineWidth: 0.2,
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [238, 245, 251],
        textColor: INK,
        fontStyle: "bold",
        fontSize: 8,
      },
      columnStyles: {
        0: { cellWidth: 8, halign: "center" },
        1: { cellWidth: 38 },
        2: { cellWidth: 24 },
        3: { cellWidth: 28 },
        4: { cellWidth: 24 },
        5: { cellWidth: "auto" },
      },
      theme: "grid",
    });

    y = doc.lastAutoTable.finalY + 8;
  }

  // ---------------------------------------------------
  // NOTES AND FOLLOW-UP
  // ---------------------------------------------------

  y = drawSection(doc, {
    y,
    title: "Consultation notes",
    body: prescription.notes,
  });

  // Last section on the page, so its return value is not needed.
  drawSection(doc, {
    y,
    title: "Follow-up",
    body: prescription.followUp,
  });

  // ---------------------------------------------------
  // FOOTER  -  on every page
  // ---------------------------------------------------

  const pageCount = doc.getNumberOfPages();

  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);

    doc.setDrawColor(...LINE);
    doc.line(MARGIN, 276, PAGE_WIDTH - MARGIN, 276);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...MUTED);

    /*
      Says exactly what this document is. It reproduces what
      the doctor submitted - it is not an independently
      verified or counter-signed medical certificate, and it
      must not imply that it is.
    */
    const disclaimer = doc.splitTextToSize(
      "This document reproduces the prescription submitted by the named " +
        "doctor through CardioCare on the date shown. CardioCare does not " +
        "review, alter or verify its clinical content. Keep it for your " +
        "records and follow your doctor's instructions. If your symptoms " +
        "worsen, seek medical attention.",
      CONTENT_WIDTH - 24
    );

    doc.text(disclaimer, MARGIN, 281);

    doc.text(`Page ${page} of ${pageCount}`, PAGE_WIDTH - MARGIN, 281, {
      align: "right",
    });
  }

  return doc;
};

/*
Filename a patient can recognise in a downloads folder six
months later. Non-filename-safe characters are stripped
rather than escaped, because some mobile browsers refuse a
download whose name contains them.
*/
export const prescriptionFileName = (prescription) => {
  const name = (prescription.patientName || "patient")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);

  const date =
    typeof prescription.createdAt?.toDate === "function"
      ? prescription.createdAt.toDate()
      : new Date();

  const stamp = Number.isNaN(date.getTime())
    ? "undated"
    : date.toISOString().slice(0, 10);

  return `prescription-${name || "patient"}-${stamp}.pdf`;
};

export const downloadPrescriptionPdf = ({ prescription, consultation }) => {
  const doc = buildPrescriptionPdf({ prescription, consultation });

  doc.save(prescriptionFileName(prescription));
};
