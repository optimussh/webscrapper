import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Webscrapper — 사이트 구조 분석 & 데이터 추출",
  description:
    "URL을 입력하면 메뉴·페이지·상세까지 크롤링하고 구조 분석, 데이터 추출, ZIP 다운로드를 제공합니다.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <div className="shell">
          <header className="topbar">
            <a href="/" className="brand">
              <span className="brand-mark">WS</span>
              <span>
                Webscrapper
                <small>structure · extract · archive</small>
              </span>
            </a>
            <a
              className="github-link"
              href="https://github.com/optimussh/webscrapper"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
          </header>
          <main className="main">{children}</main>
          <footer className="footer">
            동일 출처(same-origin)만 크롤합니다. robots·이용약관을 준수하세요.
          </footer>
        </div>
      </body>
    </html>
  );
}
