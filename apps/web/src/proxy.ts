import { NextResponse, type NextRequest } from 'next/server';

const SESSION_COOKIE = 'tm_session';
const PUBLIC_PATHS = new Set(['/giris', '/kurulum']);

/**
 * Hızlı yönlendirme: oturum çerezi yoksa uygulama sayfaları giriş ekranına, çerez varsa giriş/kurulum
 * sayfaları panoya yönlendirilir. Çerezin geçerliliği her zaman arka uçta doğrulanır.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSession = request.cookies.has(SESSION_COOKIE);

  if (PUBLIC_PATHS.has(pathname)) {
    if (hasSession) return NextResponse.redirect(new URL('/', request.url));
    return NextResponse.next();
  }

  if (!hasSession) {
    const url = new URL('/giris', request.url);
    if (pathname !== '/') url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)'],
};
