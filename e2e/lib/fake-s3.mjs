// A stand-in S3-compatible bucket (issue #119), as R2 or Backblaze B2 would be
// for the server's backups: path-style addresses (/bucket/key), PUT, GET,
// DELETE and ListObjectsV2, kept in memory. Signatures aren't checked.
import { createServer } from "node:http";

export const FAKE_S3_PORT = Number(process.env.FAKE_S3_PORT ?? 3996);
export const FAKE_S3_URL = `http://localhost:${FAKE_S3_PORT}`;

/** aws-chunked bodies (`<hex size>;chunk-signature=…\r\n<bytes>\r\n`…), as the SDK may stream them. */
function unchunk(body) {
  const parts = [];
  let at = 0;
  while (at < body.length) {
    const end = body.indexOf("\r\n", at);
    const size = parseInt(body.subarray(at, end).toString().split(";")[0], 16);
    if (!size) break;
    parts.push(body.subarray(end + 2, end + 2 + size));
    at = end + 2 + size + 2;
  }
  return Buffer.concat(parts);
}

const xml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function startFakeS3() {
  /** "bucket/key" → bytes */
  const objects = new Map();
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, FAKE_S3_URL);
    const [, bucket, ...rest] = url.pathname.split("/");
    const key = decodeURIComponent(rest.join("/"));
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    let body = Buffer.concat(chunks);
    if (req.method === "PUT") {
      if (/aws-chunked/.test(req.headers["content-encoding"] ?? "") || /STREAMING/.test(req.headers["x-amz-content-sha256"] ?? "")) body = unchunk(body);
      objects.set(`${bucket}/${key}`, body);
      res.writeHead(200, { ETag: '"fake"' }).end();
    } else if (req.method === "GET" && !key) {
      const prefix = url.searchParams.get("prefix") ?? "";
      const items = [...objects.entries()].filter(([name]) => name.startsWith(`${bucket}/${prefix}`)).map(([name, bytes]) => ({ key: name.slice(bucket.length + 1), size: bytes.length }));
      res.writeHead(200, { "Content-Type": "application/xml" }).end(
        `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>${bucket}</Name><Prefix>${xml(prefix)}</Prefix><KeyCount>${items.length}</KeyCount><IsTruncated>false</IsTruncated>${items.map((item) => `<Contents><Key>${xml(item.key)}</Key><Size>${item.size}</Size><LastModified>${new Date().toISOString()}</LastModified></Contents>`).join("")}</ListBucketResult>`,
      );
    } else if (req.method === "GET" || req.method === "HEAD") {
      const bytes = objects.get(`${bucket}/${key}`);
      if (!bytes) return res.writeHead(404, { "Content-Type": "application/xml" }).end(`<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>Not found</Message></Error>`);
      res.writeHead(200, { "Content-Length": bytes.length, "Content-Type": "application/octet-stream" }).end(req.method === "GET" ? bytes : undefined);
    } else if (req.method === "DELETE") {
      objects.delete(`${bucket}/${key}`);
      res.writeHead(204).end();
    } else {
      res.writeHead(405).end();
    }
  });
  await new Promise((resolve) => server.listen(FAKE_S3_PORT, resolve));
  return {
    url: FAKE_S3_URL,
    /** The keys in a bucket, under a prefix. */
    keys: (bucket, prefix = "") => [...objects.keys()].filter((name) => name.startsWith(`${bucket}/${prefix}`)).map((name) => name.slice(bucket.length + 1)),
    get: (bucket, key) => objects.get(`${bucket}/${key}`),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
