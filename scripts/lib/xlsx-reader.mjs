import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import { SaxesParser } from "saxes";

function localName(name) {
  return String(name).split(":").at(-1);
}

function tagName(tag) {
  return localName(typeof tag === "string" ? tag : tag.name);
}

function parseXml(xml, handlers) {
  const parser = new SaxesParser({ xmlns: false });
  if (handlers.open) parser.on("opentag", handlers.open);
  if (handlers.text) parser.on("text", handlers.text);
  if (handlers.close) parser.on("closetag", handlers.close);
  parser.write(xml).close();
}

async function zipText(zip, filename) {
  const entry = zip.file(filename);
  if (!entry) throw new Error(`Invalid .xlsx file: missing ${filename}`);
  return entry.async("string");
}

async function readSharedStrings(zip) {
  const entry = zip.file("xl/sharedStrings.xml");
  if (!entry) return [];
  const xml = await entry.async("string");
  const strings = [];
  let current = null;
  let inText = false;
  parseXml(xml, {
    open(node) {
      const name = localName(node.name);
      if (name === "si") current = "";
      if (name === "t" && current !== null) inText = true;
    },
    text(value) {
      if (inText && current !== null) current += value;
    },
    close(tag) {
      const name = tagName(tag);
      if (name === "t") inText = false;
      if (name === "si") {
        strings.push(current ?? "");
        current = null;
      }
    },
  });
  return strings;
}

function looksLikeDateFormat(formatCode) {
  const withoutQuotedText = formatCode
    .replace(/"[^"]*"/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\\./g, "");
  return /(^|[^a-z])[dmyhs]+([^a-z]|$)/i.test(withoutQuotedText);
}

async function readDateStyles(zip) {
  const entry = zip.file("xl/styles.xml");
  if (!entry) return new Set();
  const xml = await entry.async("string");
  const customFormats = new Map();
  const cellFormats = [];
  let inCellFormats = false;
  parseXml(xml, {
    open(node) {
      const name = localName(node.name);
      if (name === "numFmt") {
        customFormats.set(Number(node.attributes.numFmtId), node.attributes.formatCode ?? "");
      } else if (name === "cellXfs") {
        inCellFormats = true;
      } else if (name === "xf" && inCellFormats) {
        cellFormats.push(Number(node.attributes.numFmtId ?? 0));
      }
    },
    close(tag) {
      if (tagName(tag) === "cellXfs") inCellFormats = false;
    },
  });
  const builtInDateIds = new Set([
    14, 15, 16, 17, 18, 19, 20, 21, 22,
    27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
    45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58,
  ]);
  const dateStyles = new Set();
  cellFormats.forEach((numberFormatId, styleIndex) => {
    if (builtInDateIds.has(numberFormatId) || looksLikeDateFormat(customFormats.get(numberFormatId) ?? "")) {
      dateStyles.add(styleIndex);
    }
  });
  return dateStyles;
}

async function readWorkbookMetadata(zip) {
  const workbookXml = await zipText(zip, "xl/workbook.xml");
  const relationshipsXml = await zipText(zip, "xl/_rels/workbook.xml.rels");
  const sheets = [];
  let date1904 = false;
  parseXml(workbookXml, {
    open(node) {
      const name = localName(node.name);
      if (name === "workbookPr") date1904 = node.attributes.date1904 === "1" || node.attributes.date1904 === "true";
      if (name === "sheet") {
        sheets.push({ name: node.attributes.name, relationshipId: node.attributes["r:id"] });
      }
    },
  });

  const targets = new Map();
  parseXml(relationshipsXml, {
    open(node) {
      if (localName(node.name) === "Relationship") {
        targets.set(node.attributes.Id, node.attributes.Target);
      }
    },
  });

  return {
    date1904,
    sheets: sheets.map((sheet) => {
      const target = targets.get(sheet.relationshipId);
      if (!target) throw new Error(`Invalid .xlsx file: no worksheet relationship for ${sheet.name}`);
      return {
        name: sheet.name,
        filename: target.startsWith("/")
          ? target.slice(1)
          : path.posix.normalize(path.posix.join("xl", target)),
      };
    }),
  };
}

function decodeCellReference(reference) {
  const match = /^([A-Z]+)(\d+)$/i.exec(reference ?? "");
  if (!match) throw new Error(`Invalid cell reference: ${reference}`);
  let column = 0;
  for (const character of match[1].toUpperCase()) {
    column = column * 26 + character.charCodeAt(0) - 64;
  }
  return { row: Number(match[2]), column };
}

function excelSerialToDate(serial, date1904) {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  return new Date(epoch + serial * 86_400_000);
}

async function readWorksheet(zip, filename, sharedStrings, dateStyles, date1904) {
  const xml = await zipText(zip, filename);
  const rowMaps = new Map();
  let currentCell = null;
  let inValue = false;
  let inInlineText = false;

  parseXml(xml, {
    open(node) {
      const name = localName(node.name);
      if (name === "c") {
        currentCell = {
          reference: node.attributes.r,
          type: node.attributes.t ?? null,
          style: Number(node.attributes.s ?? 0),
          valueText: "",
          inlineText: "",
        };
      } else if (name === "v" && currentCell) {
        inValue = true;
      } else if (name === "t" && currentCell?.type === "inlineStr") {
        inInlineText = true;
      }
    },
    text(value) {
      if (inValue && currentCell) currentCell.valueText += value;
      if (inInlineText && currentCell) currentCell.inlineText += value;
    },
    close(tag) {
      const name = tagName(tag);
      if (name === "v") inValue = false;
      if (name === "t") inInlineText = false;
      if (name !== "c" || !currentCell) return;

      const { row, column } = decodeCellReference(currentCell.reference);
      let value = null;
      if (currentCell.type === "s") {
        value = sharedStrings[Number(currentCell.valueText)] ?? "";
      } else if (currentCell.type === "inlineStr") {
        value = currentCell.inlineText;
      } else if (currentCell.type === "str" || currentCell.type === "e") {
        value = currentCell.valueText;
      } else if (currentCell.type === "b") {
        value = currentCell.valueText === "1";
      } else if (currentCell.valueText !== "") {
        const numericValue = Number(currentCell.valueText);
        value = Number.isNaN(numericValue) ? currentCell.valueText : numericValue;
        if (typeof value === "number" && dateStyles.has(currentCell.style)) {
          value = excelSerialToDate(value, date1904);
        }
      }
      if (!rowMaps.has(row)) rowMaps.set(row, new Map());
      rowMaps.get(row).set(column, value);
      currentCell = null;
    },
  });

  const maxRow = Math.max(0, ...rowMaps.keys());
  const rows = Array.from({ length: maxRow }, () => []);
  for (const [rowNumber, cells] of rowMaps) {
    for (const [columnNumber, value] of cells) rows[rowNumber - 1][columnNumber - 1] = value;
  }
  return rows;
}

export async function readXlsx(inputPath) {
  const zip = await JSZip.loadAsync(await fs.readFile(inputPath));
  const [sharedStrings, dateStyles, metadata] = await Promise.all([
    readSharedStrings(zip),
    readDateStyles(zip),
    readWorkbookMetadata(zip),
  ]);
  const workbook = new Map();
  for (const sheet of metadata.sheets) {
    workbook.set(
      sheet.name,
      await readWorksheet(zip, sheet.filename, sharedStrings, dateStyles, metadata.date1904),
    );
  }
  return workbook;
}
