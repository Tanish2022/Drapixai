import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';

const API_BASE_URL = process.env.DRAPIXAI_API_URL || process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:8000';

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
    async signIn({ user }) {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/oauth/google`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: user.email, name: user.name, issueNewKey: true })
        });
        if (res.ok) {
          const data = await res.json();
          (user as any).apiKey = data.apiKey || null;
        }
      } catch {
        // ignore oauth sync failures
      }
      return true;
    },
    async jwt({ token, user }) {
      if (user && (user as any).apiKey) {
        (token as any).apiKey = (user as any).apiKey;
      }
      return token;
    },
    async session({ session, token }) {
      (session as any).apiKey = (token as any).apiKey || null;
      return session;
    }
  }
});

export { handler as GET, handler as POST };
