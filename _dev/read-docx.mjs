import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docxPath = path.resolve(__dirname, '..', 'reference', '极速识词_课堂互动版_V3_游戏化课堂互动与一体机优化开发文档.docx');

const JSZip = (await import('jszip')).default;
const data = fs.readFileSync(docxPath);
const zip = await JSZip.loadAsync(data);
const docXml = await zip.file('word/document.xml').async('nodebuffer');
const xmlStr = docXml.toString('utf-8');

// Parse XML to extract text
const textMatches = xmlStr.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
const texts = textMatches.map(m => m.replace(/<[^>]+>/g, ''));

const fullText = texts.join('');
console.log(fullText);