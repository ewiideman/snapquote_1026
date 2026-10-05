// An RFQ email dropped in from Outlook (.msg) or saved as .eml: who sent it, when, the subject, the
// text, and the files attached. Read on this server; nothing is sent anywhere.
import { simpleParser } from 'mailparser';
import { createRequire } from 'node:module';
import type * as MsgReaderModule from '@kenjiuno/msgreader/lib/MsgReader.js';

export interface ParsedEmail {
  subject: string;
  fromName: string;
  fromAddress: string;
  date: string | null;
  text: string;
  attachments: { fileName: string; contentType: string; bytes: Buffer }[];
}

export const isEmail = (fileName: string): boolean => /\.(eml|msg)$/i.test(fileName);

// The package is CommonJS with its class as `default`; required directly so no loader wraps it again.
const MsgReader = (createRequire(import.meta.url)('@kenjiuno/msgreader') as { default: typeof MsgReaderModule.default.default }).default;

export async function readEmail(fileName: string, bytes: Buffer): Promise<ParsedEmail> {
  if (/\.eml$/i.test(fileName)) {
    const m = await simpleParser(bytes);
    const from = m.from?.value[0];
    return {
      subject: m.subject ?? '',
      fromName: from?.name ?? '',
      fromAddress: from?.address ?? '',
      date: m.date ? m.date.toISOString() : null,
      text: m.text ?? '',
      attachments: m.attachments.filter((a) => a.contentDisposition !== 'inline' || a.filename).map((a) => ({
        fileName: a.filename ?? 'attachment', contentType: a.contentType || 'application/octet-stream', bytes: a.content,
      })),
    };
  }
  const reader = new MsgReader(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  const info = reader.getFileData();
  const attachments = (info.attachments ?? []).flatMap((a) => {
    if (a.innerMsgContent) return [];
    const file = reader.getAttachment(a);
    return file?.content ? [{ fileName: file.fileName || a.fileName || 'attachment', contentType: a.attachMimeTag || 'application/octet-stream', bytes: Buffer.from(file.content) }] : [];
  });
  const date = info.messageDeliveryTime ?? info.clientSubmitTime ?? null;
  return {
    subject: info.subject ?? '',
    fromName: info.senderName ?? '',
    fromAddress: info.senderSmtpAddress ?? info.senderEmail ?? '',
    date: date ? new Date(date).toISOString() : null,
    text: info.body ?? '',
    attachments,
  };
}
