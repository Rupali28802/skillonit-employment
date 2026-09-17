import sharp from 'sharp';
import { ApiError, audit } from './security.js';
import { read, transaction } from './store.js';
import type { User } from './domain.js';

export const mediaKinds = ['avatar', 'cover', 'logo'] as const;
export type MediaKind = typeof mediaKinds[number];
export async function profileImage(request: Request, user: User, kind: MediaKind) {
  const key = `${user.id}:${kind}`;
  if (request.method === 'GET') {
    const image = await read(r => r.get<{ data: string }>('profileMedia', key));
    if (!image) throw new ApiError(404, 'NOT_FOUND', 'No image uploaded.');
    return new Response(new Uint8Array(Buffer.from(image.data, 'base64')), {
      headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' },
    });
  }
  if (!['PUT', 'DELETE'].includes(request.method)) throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed.');
  let encoded: Buffer | undefined;
  if (request.method === 'PUT') {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(request.headers.get('content-type') || ''))
      throw new ApiError(415, 'INVALID_IMAGE', 'Choose a JPG, PNG or WebP image.');
    const bytes = Buffer.from(await request.arrayBuffer());
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw new ApiError(413, 'TOO_LARGE', 'Images must be under 2 MB.');
    try {
      const image = sharp(bytes, { limitInputPixels: 16000000 });
      const metadata = await image.metadata();
      if (!['jpeg', 'png', 'webp'].includes(metadata.format || '') || (metadata.pages || 1) > 1) throw Error('Unsupported image');
      encoded = await image.rotate().resize(kind === 'cover' ? 1000 : 320, kind === 'cover' ? 360 : 320, { fit: 'cover' }).webp({ quality: 82 }).toBuffer();
    } catch { throw new ApiError(400, 'INVALID_IMAGE', 'This image could not be read. Choose a JPG, PNG or WebP under 16 megapixels.'); }
  }
  const version = encoded ? String(Date.now()) : undefined;
  await transaction(async r => {
    const latest = await r.get<User>('users', user.id);
    if (!latest) throw new ApiError(404, 'NOT_FOUND', 'Account not found.');
    if (encoded) await r.put('profileMedia', { id: key, userId: user.id, kind, data: encoded.toString('base64') });
    else await r.remove('profileMedia', key);
    await r.put('users', { ...latest, profile: { ...latest.profile, [`${kind}Version`]: version } });
    await audit(r, user.id, `profile.${kind}.${encoded ? 'updated' : 'removed'}`, user.id);
  });
  return Response.json({ data: { version: version || null } });
}
