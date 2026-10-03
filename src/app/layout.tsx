import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Webscrapper — 참고 수집과 구현 브리프",
  description:
    "URL 한 번으로 구조, 페이지 정보, wget 참고 파일을 ZIP으로 받고 AI 구현 가이드를 포함합니다.",
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
                <small>structure · reference · brief</small>
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
            공개 http(s) 사이트만, 같은 사이트 범위로 수집합니다. robots와 이용약관을 확인하고, 받은 파일은 참고로만 씁니다.
          </footer>
        </div>
      </body>
    </html>
  );
}
