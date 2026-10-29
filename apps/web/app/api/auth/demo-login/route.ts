/**
 * POST /api/auth/demo-login
 *
 * Masuk cepat sebagai salah satu akun demo (tanpa password).
 * Hanya tersedia bila RIGDAILY_DEMO=1; selain itu 404.
 */
import { z } from 'zod';
import { fail, getClientIp, ok, parseBody, readJson } from '@/lib/api-response';
import { loginDemo, recordAudit } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const zBody = z.object({
  email: z.string().trim().email('Email demo tidak valid.'),
});

export async function POST(req: Request): Promise<Response> {
  try {
    const body = parseBody(zBody, await readJson(req));
    const ip = getClientIp(req);
    const terminal = req.headers.get('user-agent')?.slice(0, 300) ?? null;

    const user = await loginDemo(body.email);

    await recordAudit({
      entity: 'auth',
      entityId: user.id,
      action: 'login',
      actor: user,
      ip,
      terminal,
      newJson: { email: user.email, role: user.role, demo: true },
    });

    return ok({
      user,
      demo: true,
      expiresAt: new Date(Date.now() + 8 * 3600 * 1000).toISOString(),
    });
  } catch (err) {
    return fail(err);
  }
}
