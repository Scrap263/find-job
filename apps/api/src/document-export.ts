import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  Packer,
  PageBreak,
  PageNumber,
  Paragraph,
  TextRun
} from "docx";
import { fileURLToPath } from "node:url";
import PDFDocument from "pdfkit";

export type DocumentExportInput = {
  candidateName: string;
  jobTitle: string;
  company: string;
  location: string;
  resumeSummary: string;
  coverLetter: string;
};

const green = "173027";
const muted = "66756D";
const regularFontPath = fileURLToPath(
  new URL(
    "../../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf",
    import.meta.url
  )
);
const boldFontPath = fileURLToPath(
  new URL(
    "../../../node_modules/dejavu-fonts-ttf/ttf/DejaVuSans-Bold.ttf",
    import.meta.url
  )
);

function textParagraphs(text: string) {
  return text.split("\n").map((line) => {
    const trimmed = line.trim();

    if (trimmed.startsWith("• ")) {
      return new Paragraph({
        text: trimmed.slice(2),
        bullet: { level: 0 },
        spacing: { after: 100, line: 276 }
      });
    }

    return new Paragraph({
      children: trimmed ? [new TextRun(trimmed)] : [],
      spacing: { after: trimmed ? 120 : 40, line: 276 }
    });
  });
}

export async function createDocxExport(input: DocumentExportInput) {
  const document = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: "Arial",
            size: 22,
            color: "17221D"
          },
          paragraph: {
            spacing: { after: 120, line: 276 }
          }
        },
        heading1: {
          run: {
            font: "Arial",
            size: 32,
            bold: true,
            color: green
          },
          paragraph: {
            spacing: { before: 240, after: 140 }
          }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: 12_240, height: 15_840 },
            margin: {
              top: 1_080,
              right: 1_080,
              bottom: 1_080,
              left: 1_080,
              header: 540,
              footer: 540
            }
          }
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "FIND JOB  ·  APPLICATION PACKET",
                    bold: true,
                    color: muted,
                    size: 16
                  })
                ],
                spacing: { after: 80 }
              })
            ]
          })
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({ text: "Page ", color: muted, size: 16 }),
                  new TextRun({
                    children: [PageNumber.CURRENT],
                    color: muted,
                    size: 16
                  })
                ]
              })
            ]
          })
        },
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: input.candidateName,
                bold: true,
                color: green,
                size: 48
              })
            ],
            spacing: { after: 80 }
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `${input.jobTitle} · ${input.company} · ${input.location}`,
                color: muted,
                size: 22
              })
            ],
            spacing: { after: 260 }
          }),
          new Paragraph({
            text: "Адаптированное резюме",
            heading: HeadingLevel.HEADING_1
          }),
          ...textParagraphs(input.resumeSummary),
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({
            text: "Сопроводительное письмо",
            heading: HeadingLevel.HEADING_1
          }),
          ...textParagraphs(input.coverLetter)
        ]
      }
    ]
  });

  return Packer.toBuffer(document);
}

function writePdfBody(
  document: PDFKit.PDFDocument,
  text: string,
  regularFont: string
) {
  const left = document.page.margins.left;
  const width =
    document.page.width -
    document.page.margins.left -
    document.page.margins.right;

  const lines = text.split("\n");

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();

    if (!trimmed) {
      document.moveDown(0.55);
      continue;
    }

    if (trimmed.startsWith("• ")) {
      document
        .font(regularFont)
        .fontSize(10.5)
        .fillColor("#17221D")
        .text(`•  ${trimmed.slice(2)}`, left, document.y, {
          width,
          indent: 12,
          paragraphGap: 5,
          lineGap: 2
        });
      continue;
    }

    document
      .font(regularFont)
      .fontSize(10.5)
      .fillColor("#17221D")
      .text(trimmed, left, document.y, {
        width,
        paragraphGap: 5,
        lineGap: 2
      });

    if (lines[index + 1]?.trim().startsWith("• ")) {
      document.moveDown(0.35);
    }
  }
}

export async function createPdfExport(input: DocumentExportInput) {
  const document = new PDFDocument({
    size: "LETTER",
    margins: { top: 54, right: 54, bottom: 58, left: 54 },
    bufferPages: true,
    info: {
      Title: `${input.candidateName} - ${input.jobTitle}`,
      Author: input.candidateName,
      Creator: "Find Job"
    }
  });
  const chunks: Buffer[] = [];
  document.on("data", (chunk: Buffer) => chunks.push(chunk));
  const completed = new Promise<Buffer>((resolve, reject) => {
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });

  document.registerFont("DejaVuSans", regularFontPath);
  document.registerFont("DejaVuSansBold", boldFontPath);

  document
    .font("DejaVuSansBold")
    .fontSize(8)
    .fillColor("#66756D")
    .text("FIND JOB  ·  APPLICATION PACKET", { characterSpacing: 0.8 });
  document.moveDown(2);
  document
    .font("DejaVuSansBold")
    .fontSize(24)
    .fillColor("#173027")
    .text(input.candidateName);
  document
    .font("DejaVuSans")
    .fontSize(10.5)
    .fillColor("#66756D")
    .text(`${input.jobTitle} · ${input.company} · ${input.location}`);
  document.moveDown(1.5);
  document
    .strokeColor("#DDE5E0")
    .lineWidth(1)
    .moveTo(54, document.y)
    .lineTo(558, document.y)
    .stroke();
  document.moveDown(1.4);
  document
    .font("DejaVuSansBold")
    .fontSize(16)
    .fillColor("#173027")
    .text("Адаптированное резюме");
  document.moveDown(0.8);
  writePdfBody(document, input.resumeSummary, "DejaVuSans");

  document.addPage();
  document
    .font("DejaVuSansBold")
    .fontSize(16)
    .fillColor("#173027")
    .text("Сопроводительное письмо");
  document.moveDown(0.8);
  writePdfBody(document, input.coverLetter, "DejaVuSans");

  const range = document.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    document.switchToPage(index);
    const bottomMargin = document.page.margins.bottom;
    document.page.margins.bottom = 0;
    document
      .font("DejaVuSans")
      .fontSize(8)
      .fillColor("#7C8781")
      .text(`${index + 1} / ${range.count}`, 500, 760, {
        width: 58,
        align: "right",
        lineBreak: false
      });
    document.page.margins.bottom = bottomMargin;
  }

  document.end();
  return completed;
}

export function safeExportFileName(input: DocumentExportInput) {
  const value = `${input.candidateName}-${input.company}-${input.jobTitle}`
    .normalize("NFC")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return value || "application";
}
