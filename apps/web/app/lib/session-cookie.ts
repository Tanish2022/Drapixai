export const sessionCookieName = (legacyName: string) =>
  process.env.NODE_ENV === 'production' ? `__Host-${legacyName}` : legacyName;

export const sessionCookie = (name: string, value: string, maxAge: number) => ({
  name, value, maxAge,
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production' || name.startsWith('__Host-'),
  sameSite: 'strict' as const,
  path: '/',
});

type CookieWriter = { set: (options: ReturnType<typeof sessionCookie>) => unknown };

export const retireLegacySessionCookie = (store: CookieWriter, legacyName: string) => {
  if (process.env.NODE_ENV === 'production') store.set(sessionCookie(legacyName, '', 0));
};

export const clearSessionCookies = (store: CookieWriter, name: string, legacyName: string) => {
  store.set(sessionCookie(name, '', 0));
  retireLegacySessionCookie(store, legacyName);
};
