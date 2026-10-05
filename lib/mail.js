import nodemailer from "nodemailer";
import { loadEnv } from "./tinyfish.js";

export function emailConfigured() { loadEnv(); return !!process.env.SMTP_HOST; }

export async function sendAlert(to, subject, text) {
  loadEnv();
  if (!to || !process.env.SMTP_HOST) return { sent: false, reason: "email not configured" };
  try {
    const t = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    await t.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text });
    return { sent: true };
  } catch (e) { return { sent: false, reason: e.message }; }
}
