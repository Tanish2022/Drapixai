import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

const API_BASE_URL = process.env.DRAPIXAI_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';
const AUTH_SYNC_TOKEN = process.env.DRAPIXAI_AUTH_SYNC_TOKEN || '';

const googleClientId = process.env.GOOGLE_CLIENT_ID || '';
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET || '';

const providers = googleClientId && googleClientSecret
  ? [
      GoogleProvider({
        clientId: googleClientId,
        clientSecret: googleClientSecret,
      }),
    ]
  : [];

const handler = NextAuth({
  providers,
  session: { strategy: 'jwt' },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async signIn({ user, profile }) {
      const googleProfile = profile as { email?: unknown; email_verified?: unknown } | undefined;
      if (googleProfile?.email_verified !== true
        || typeof googleProfile.email !== 'string'
        || typeof user.email !== 'string'
        || googleProfile.email.trim().toLowerCase() !== user.email.trim().toLowerCase()) return false;
      try {
        const res = await fetch(`${API_BASE_URL}/auth/oauth/google`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(AUTH_SYNC_TOKEN ? { 'x-drapixai-auth-sync-token': AUTH_SYNC_TOKEN } : {}),
          },
          body: JSON.stringify({ email: user.email, name: user.name, issueNewKey: true })
        });
        if (!res.ok) return false;
        const data = await res.json();
        if (!data.apiKey) return false;
        (user as any).apiKey = data.apiKey;
        return true;
      } catch {
        return false;
      }
    },
    async jwt({ token, user }) {
      if (user && (user as any).apiKey) {
        (token as any).apiKey = (user as any).apiKey;
      }
      return token;
    },
    async session({ session }) {
      return session;
    }
  }
});

export { handler as GET, handler as POST };
