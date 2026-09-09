import { PDFDocument } from 'pdf-lib';
import { fromBuffer, type Entry } from 'yauzl';
import { SaxesParser } from 'saxes';
// Isolated process, bounded heap and parent-enforced timeout. Never render/execute CV content.
process.once('message', async (message: { bytes: string; type: string }) => {
  try {
    const bytes = Buffer.from(message.bytes, 'base64');
    if (message.type === 'application/pdf') {
      const doc = await PDFDocument.load(bytes, { throwOnInvalidObject: true });
      if (doc.isEncrypted || doc.getPageCount() < 1 || doc.getPageCount() > 100) throw new Error();
    } else {
      await new Promise<void>((resolve, reject) => fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, zip) => {
        if (error || !zip) return reject(new Error());
        let total = 0, count = 0; const names = new Set<string>();
        const fail = () => { zip.close(); reject(new Error()); };
        zip.on('error', fail);
        zip.on('entry', (entry: Entry) => {
          if (++count > 300 || names.has(entry.fileName) || /(?:^|\/)\.\.(?:\/|$)|^\/|\\|vbaProject|embeddings\//i.test(entry.fileName) || entry.generalPurposeBitFlag & 1 || (total += entry.uncompressedSize) > 20971520 || entry.uncompressedSize > 5242880) return fail();
          names.add(entry.fileName);
          if (/\/$/.test(entry.fileName)) return zip.readEntry();
          zip.openReadStream(entry, (err, stream) => {
            if (err || !stream) return fail();
            const chunks: Buffer[] = []; let actual = 0;
            stream.on('error', fail);
            stream.on('data', (chunk: Buffer) => { actual += chunk.length; if (actual > 5242880) { stream.destroy(); fail(); } else if (/\.xml$|\.rels$/.test(entry.fileName)) chunks.push(chunk); });
            stream.on('end', () => {
              const text = Buffer.concat(chunks).toString('utf8');
              if (/<!DOCTYPE|<!ENTITY|TargetMode\s*=\s*["']External|macroEnabled/i.test(text)) return fail();
              if (chunks.length) { try { new SaxesParser({ xmlns: true }).write(text).close(); } catch { return fail(); } }
              if (entry.fileName === 'word/document.xml' && !/<(?:\w+:)?document\b/.test(text)) return fail();
              zip.readEntry();
            });
          });
        });
        zip.on('end', () => { zip.close(); if (!names.has('[Content_Types].xml') || !names.has('word/document.xml') || !names.has('_rels/.rels')) reject(new Error()); else resolve(); });
        zip.readEntry();
      }));
    }
    process.send?.({ valid: true });
  } catch { process.send?.({ valid: false }); }
  finally { process.disconnect(); }
});
