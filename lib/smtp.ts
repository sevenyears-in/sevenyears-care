// Minimal SMTP sender using only Node's built-in modules (no extra packages).
// Supports port 465 (SSL) and port 587 (STARTTLS) with AUTH LOGIN — enough for
// Hostinger mail, Gmail (app password), Zoho Mail and most providers.

import net from "node:net";
import tls from "node:tls";
import { randomBytes } from "node:crypto";

export type SmtpOptions = {
  host: string;
  port: number;
  user: string;
  pass: string;
};

export type MailMessage = {
  from: string; // e-mail address
  fromName: string;
  to: string;
  subject: string;
  text: string;
  html: string;
};

type Conn = {
  socket: net.Socket | tls.TLSSocket;
  buffer: string;
  replies: string[];
  waiters: ((reply: string) => void)[];
};

function attach(socket: net.Socket | tls.TLSSocket): Conn {
  const conn: Conn = { socket, buffer: "", replies: [], waiters: [] };
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    conn.buffer += chunk;
    // A full reply ends with a line "NNN text" (space, not dash, after the code).
    let lines = conn.buffer.split("\r\n");
    let start = 0;
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3}(?: |$)/.test(lines[i])) {
        const reply = lines.slice(start, i + 1).join("\n");
        start = i + 1;
        const waiter = conn.waiters.shift();
        if (waiter) waiter(reply);
        else conn.replies.push(reply);
      }
    }
    lines = lines.slice(start);
    conn.buffer = lines.join("\r\n");
  });
  return conn;
}

function read(conn: Conn, timeoutMs = 20000): Promise<string> {
  const ready = conn.replies.shift();
  if (ready !== undefined) return Promise.resolve(ready);
  return new Promise((resolve, reject) => {
    const waiter = (reply: string) => {
      clearTimeout(timer);
      resolve(reply);
    };
    const timer = setTimeout(() => {
      conn.waiters = conn.waiters.filter((w) => w !== waiter);
      reject(new Error("SMTP server did not reply in time."));
    }, timeoutMs);
    conn.waiters.push(waiter);
  });
}

async function command(conn: Conn, line: string | null, expect: number[]) {
  if (line !== null) conn.socket.write(`${line}\r\n`);
  const reply = await read(conn);
  const code = Number(reply.slice(0, 3));
  if (!expect.includes(code)) {
    const shown = line?.startsWith("AUTH") || (line && /^[A-Za-z0-9+/=]+$/.test(line)) ? "(login)" : line;
    throw new Error(`SMTP ${shown ?? "greeting"} failed: ${reply.replace(/\s+/g, " ").slice(0, 200)}`);
  }
  return reply;
}

function encodeHeader(value: string) {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function base64Lines(value: string) {
  return (Buffer.from(value, "utf8").toString("base64").match(/.{1,76}/g) ?? []).join("\r\n");
}

function buildMessage(m: MailMessage) {
  const boundary = `sy_${randomBytes(12).toString("hex")}`;
  const domain = m.from.split("@")[1] ?? "localhost";
  return [
    `From: ${encodeHeader(m.fromName)} <${m.from}>`,
    `To: <${m.to}>`,
    `Subject: ${encodeHeader(m.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${randomBytes(16).toString("hex")}@${domain}>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(m.text),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(m.html),
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

function connect(options: SmtpOptions): Promise<net.Socket | tls.TLSSocket> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    const socket =
      options.port === 465
        ? tls.connect({ host: options.host, port: options.port, servername: options.host }, () => resolve(socket))
        : net.connect({ host: options.host, port: options.port }, () => resolve(socket));
    socket.once("error", onError);
    socket.setTimeout(30000, () => socket.destroy(new Error("SMTP connection timed out.")));
  });
}

export async function sendSmtpMail(options: SmtpOptions, message: MailMessage) {
  let socket = await connect(options);
  let conn = attach(socket);

  try {
    await command(conn, null, [220]);
    let ehlo = await command(conn, "EHLO care.sevenyears.in", [250]);

    if (!(socket instanceof tls.TLSSocket)) {
      if (!/STARTTLS/i.test(ehlo)) throw new Error("SMTP server does not offer a secure connection (STARTTLS).");
      await command(conn, "STARTTLS", [220]);
      socket.removeAllListeners("data");
      socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const secure = tls.connect({ socket, servername: options.host }, () => resolve(secure));
        secure.once("error", reject);
      });
      conn = attach(socket);
      ehlo = await command(conn, "EHLO care.sevenyears.in", [250]);
    }

    void ehlo;
    await command(conn, "AUTH LOGIN", [334]);
    await command(conn, Buffer.from(options.user).toString("base64"), [334]);
    await command(conn, Buffer.from(options.pass).toString("base64"), [235]);
    await command(conn, `MAIL FROM:<${message.from}>`, [250]);
    await command(conn, `RCPT TO:<${message.to}>`, [250, 251]);
    await command(conn, "DATA", [354]);
    // Dot-stuffing: a line starting with "." gets an extra "."
    const body = buildMessage(message).replace(/\r\n\./g, "\r\n..");
    await command(conn, `${body}\r\n.`, [250]);
    await command(conn, "QUIT", [221]).catch(() => null);
  } finally {
    socket.end();
  }
}
