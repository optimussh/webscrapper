import fs from "node:fs/promises";
import path from "node:path";
import type { AiBrief, BriefPage, MirrorReport, PageStructure, SiteType } from "./types";

const DO_NOT_COPY = [
  "html",
  "css",
  "javascript",
  "class names",
  "svg and icons",
  "images",
  "font files",
  "logos and wordmarks",
  "verbatim marketing copy",
  "source trademarks and product names",
];

const ALLOWED_ASSETS = [
  "SIL OFL or Apache-2.0 fonts such as Noto Sans KR, Noto Serif KR, Inter, Source Sans 3, IBM Plex Sans, JetBrains Mono",
  "Icons from an ISC/MIT/Apache set such as Lucide, or original SVG",
  "Images you create, commission, or take from CC0 / public domain",
  "Original interface copy",
];

export async function writeAiBrief(
  jobRoot: string,
  input: {
    startUrl: string;
    siteType: SiteType;
    pages: PageStructure[];
    mirror?: MirrorReport;
  },
): Promise<AiBrief> {
  const brief: AiBrief = {
    version: 1,
    purpose: "original-implementation-from-structure",
    startUrl: input.startUrl,
    siteType: input.siteType,
    legal: {
      use: "reference-only",
      buildFrom: "scratch",
      notLegalAdvice: true,
      doNotCopy: DO_NOT_COPY,
      allowedAssets: ALLOWED_ASSETS,
    },
    pages: input.pages.map(toBriefPage),
    sourceStackHints: stackHints(input.pages),
    mirror: input.mirror
      ? {
          engine: input.mirror.engine,
          files: input.mirror.files,
          bytes: input.mirror.bytes,
        }
      : undefined,
  };

  await fs.mkdir(path.join(jobRoot, "ai-brief"), { recursive: true });
  await fs.mkdir(path.join(jobRoot, "reference"), { recursive: true });
  await fs.writeFile(
    path.join(jobRoot, "ai-brief", "brief.json"),
    JSON.stringify(brief, null, 2),
    "utf8",
  );
  await fs.writeFile(path.join(jobRoot, "ai-brief", "GUIDE.md"), renderGuide(brief), "utf8");
  await fs.writeFile(path.join(jobRoot, "START-HERE.md"), renderStartHere(brief), "utf8");
  await fs.writeFile(path.join(jobRoot, "reference", "README.md"), renderReferenceReadme(), "utf8");
  return brief;
}

function toBriefPage(page: PageStructure): BriefPage {
  return {
    url: page.url,
    path: pagePath(page.url),
    title: (page.title || "").slice(0, 120),
    depth: page.depth,
    wordCount: page.wordCount,
    imageCount: page.images,
    formCount: page.forms.length,
    navLinkCount: page.navLinks.length,
    internalLinkCount: page.internalLinks.length,
    sourceLabels: page.headings.slice(0, 12).map((heading) => ({
      level: heading.level,
      text: heading.text.replace(/\s+/g, " ").trim().slice(0, 80),
      reuse: "forbidden-rewrite" as const,
    })),
    sectionSketch: sectionSketch(page),
  };
}

function sectionSketch(page: PageStructure): BriefPage["sectionSketch"] {
  const sections: BriefPage["sectionSketch"] = [];
  if (page.navLinks.length) sections.push({ kind: "navigation", count: page.navLinks.length });
  const h1 = page.headings.filter((heading) => heading.level === 1).length;
  if (h1) sections.push({ kind: "title-block", count: h1 });
  const h2 = page.headings.filter((heading) => heading.level === 2).length;
  if (h2) sections.push({ kind: "content-blocks", count: h2 });
  const deeper = page.headings.filter((heading) => heading.level >= 3).length;
  if (deeper) sections.push({ kind: "subsections", count: deeper });
  if (page.forms.length) sections.push({ kind: "form", count: page.forms.length });
  if (page.images > 0) sections.push({ kind: "media", count: page.images });
  if (!sections.length) sections.push({ kind: "page", count: 1 });
  return sections;
}

function stackHints(pages: PageStructure[]): string[] {
  const hints = new Set<string>();
  for (const page of pages) {
    for (const name of page.signals?.frameworks || []) hints.add(name);
  }
  return [...hints].slice(0, 12);
}

function pagePath(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "/";
  }
}

function renderStartHere(brief: AiBrief): string {
  return `# 이 ZIP을 여는 순서

1. 구현을 맡기기 전에 \`ai-brief/GUIDE.md\` 를 읽습니다.
2. 구조 데이터는 \`ai-brief/brief.json\` 에 있습니다.
3. \`reference/\`, \`html/\`, \`screenshots/\`, \`markdown/\` 은 화면이 어떤 덩어리로 나뉘는지 보기 위한 참고입니다.

대상: ${brief.startUrl}

새 저장소에는 이 ZIP의 파일(HTML, CSS, 이미지, 폰트, 로고)을 넣지 않습니다.
섹션의 종류와 순서만 가져가고, 문장·색·서체·이미지는 새로 만듭니다.
`;
}

function renderReferenceReadme(): string {
  return `# reference — 보기 전용

이 폴더의 미러(\`mirror/\`)와 \`design-observations.json\` 은 원본 사이트의 파일과 측정값입니다.

- 새 프로젝트 소스에 복사하지 않습니다.
- 이미지, 폰트, SVG, CSS, 클래스 이름을 재사용하지 않습니다.
- \`design-observations.json\` 의 색 코드와 폰트 이름은 관찰 기록입니다. 팔레트나 서체 지정으로 쓰지 않습니다.
- 스크린샷은 섹션이 위에서 아래로 어떤 순서인지 확인할 때만 엽니다.

라이선스가 확인된 자산만 새 사이트에 넣습니다. 기본값은 SIL OFL / Apache-2.0 폰트, ISC·MIT 아이콘, 직접 만든 이미지와 문장입니다.
`;
}

function renderGuide(brief: AiBrief): string {
  const pages = [...brief.pages].sort((a, b) => a.depth - b.depth || a.path.localeCompare(b.path));
  const ia = pages
    .map((page) => {
      const labels = page.sourceLabels
        .map((label) => `H${label.level} ${label.text}`)
        .join(" / ");
      const sketch = page.sectionSketch.map((section) => `${section.kind}×${section.count}`).join(", ");
      return [
        `${"  ".repeat(Math.min(page.depth, 5))}- \`${page.path}\` — 소스 제목 라벨: ${page.title || "(없음)"}`,
        `${"  ".repeat(Math.min(page.depth, 5))}  덩어리: ${sketch}`,
        `${"  ".repeat(Math.min(page.depth, 5))}  분량: 단어 약 ${page.wordCount}, 이미지 ${page.imageCount}, 폼 ${page.formCount}, 내비게이션 링크 ${page.navLinkCount}`,
        labels
          ? `${"  ".repeat(Math.min(page.depth, 5))}  주제 라벨(문장 재사용 금지): ${labels}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");

  const stack = brief.sourceStackHints.length
    ? brief.sourceStackHints.join(", ")
    : "(감지된 프레임워크 없음)";
  const mirror = brief.mirror
    ? `${brief.mirror.engine}, 파일 ${brief.mirror.files}개, ${brief.mirror.bytes} bytes`
    : "이번 잡에는 wget 미러가 없습니다. 구조 브리프만 사용합니다.";

  return `# AI 구현 가이드

이 문서는 Grok, Codex, Claude Code 같은 코딩 에이전트가 **비슷한 구성의 사이트를 처음부터** 만들 때 읽는 지시서입니다.
스크랩 파일은 참고입니다. 새 사이트의 문장, 색, 서체, 이미지, 로고, 코드는 새로 작성합니다.

이 가이드는 법률 자문이 아닙니다. 대상 사이트의 이용약관, robots.txt, 상표, 저작권은 작업을 맡기는 사람이 확인합니다.
여기서 말하는 안전 장치는 “표현을 베끼지 않고, 라이선스가 자유로운 재료로 다시 짠다”는 작업 규칙입니다.

## 에이전트에 붙이는 첫 문장

\`\`\`
이 ZIP의 ai-brief/GUIDE.md 와 ai-brief/brief.json 만 구현 지시로 사용해.
reference/, html/, screenshots/, markdown/ 는 섹션 순서를 이해하기 위해 보고, 그 파일은 새 프로젝트에 복사하지 마.
카피, 로고, 색 코드, 폰트 파일, 이미지는 새로 만들어. 폰트는 GUIDE의 OFL 목록에서 골라.
소스의 브랜드명과 제품명은 쓰지 마.
\`\`\`

## Rules for the coding agent

You are building an original website. The information architecture in \`ai-brief/brief.json\` is the only implementation input.

Do not copy HTML, CSS, JavaScript, class names, SVG, images, font files, logos, or verbatim sentences from \`reference/\`, \`html/\`, \`screenshots/\`, or \`markdown/\`.
Do not commit any file from this ZIP into the new repository.
Do not reproduce the source trademark, wordmark, or product name.
Rewrite every user-facing string. Heading labels in the brief are topic hints with \`reuse: forbidden-rewrite\`.
Follow section kinds and their order (navigation, title block, content blocks, form, media). Invent your own spacing, type scale, and palette.
A similar mood is in bounds. A look-alike that could be mistaken for the source site is out of bounds. If matching the source would recreate a distinctive combination of layout, color, and type, change the palette, the type, and the composition.
Fonts: use SIL OFL or Apache-2.0 families only. Do not ship font files found in the mirror, even if the family name looks familiar, unless you have checked that family's license yourself. Default to the list in this guide.
Images: original, commissioned, or CC0 / public domain. Do not use scraped or hotlinked bitmaps.
Icons: Lucide (ISC) or original SVG. Do not trace the source icons.
\`reference/design-observations.json\` records measured colors and font names. Those values are not a design spec. Do not paste the hex codes into the new CSS.
Open screenshots only to confirm section order, then close them before writing CSS.
Do not claim the new site is affiliated with the source.
This guide is an engineering workflow, not legal advice.

## 가져가도 되는 것

- 페이지가 몇 개인지, 주소 경로가 어떤 깊이인지
- 한 페이지 안의 덩어리 종류와 개수 (제목 블록, 내용 블록, 폼, 미디어, 내비게이션)
- 덩어리가 위에서 아래로 놓인 순서
- 폼이 있는지, 이미지가 대략 몇 개인지 같은 구조 사실

## 가져가면 안 되는 것

- \`reference/mirror/\` 의 HTML, CSS, JS, 이미지, 폰트, 아이콘
- \`html/\`, \`markdown/\` 의 문장을 그대로 붙이는 일
- \`screenshots/\` 를 새 사이트의 이미지로 쓰는 일
- 소스의 로고, 워드마크, 브랜드명, 제품명
- 관찰된 색 코드를 새 팔레트로 복사하는 일
- 소스와 혼동될 만큼 같은 배치·서체·색 조합

## 라이선스가 자유로운 기본 재료

폰트 (SIL Open Font License 계열로 널리 배포되는 패밀리):

- Noto Sans KR, Noto Serif KR
- Inter
- Source Sans 3
- IBM Plex Sans
- 코드가 필요하면 JetBrains Mono

쓰기 전에 각 패밀리의 현재 라이선스 고지를 확인합니다. 미러 폴더 안의 폰트 파일은 쓰지 않습니다.

아이콘은 Lucide(ISC) 또는 직접 그린 SVG.
사진은 직접 찍거나 의뢰하거나 CC0·퍼블릭 도메인만 사용합니다.
UI 문장은 새로 씁니다. 소스 제목은 주제를 알기 위한 라벨입니다.

## 이 잡에서 본 구조

- 시작 URL: ${brief.startUrl}
- 수집 방식: ${brief.siteType}
- 페이지 수: ${brief.pages.length}
- 디자인 파일 미러: ${mirror}
- 소스에서 감지된 기술 힌트 (따라 할 필요 없음): ${stack}

${ia || "(수집된 페이지 없음)"}

## 구현 순서

1. \`brief.json\` 의 \`pages\` 와 \`sectionSketch\` 만 보고 페이지 목록과 섹션 컴포넌트를 정합니다.
2. 각 섹션을 빈 상태로 배치합니다. 이 단계에서는 소스 CSS를 열지 않습니다.
3. 분위기 단어만 정합니다. 예: 밝은 배경, 넓은 여백, 강조색 하나. 색 코드는 직접 고릅니다.
4. 위의 OFL 폰트 목록에서 본문과 제목 서체를 고르고, 크기 단계도 직접 정합니다.
5. 내비게이션 항목 수에 맞춰 메뉴를 만들되, 메뉴 문장은 새로 씁니다.
6. 폼이 있는 페이지는 필드 목적이 드러나게 다시 구성합니다. 소스의 \`name\` 값과 라벨 문장을 복사하지 않습니다.
7. 이미지 자리가 있으면 크기만 잡고, 파일은 CC0 또는 직접 만든 것으로 채웁니다.
8. 구현이 끝나면 새 저장소에 \`reference\`, \`html\`, \`screenshots\`, \`markdown\`, \`mirror\` 가 없는지 확인합니다.

## 끝내기 전에

- 새 저장소에 이 ZIP의 바이너리와 스타일시트가 없다
- 사용자에게 보이는 문장이 소스 문장과 겹치지 않는다
- 로고와 브랜드명이 소스와 다르다
- 폰트가 OFL 또는 Apache-2.0 목록 안에 있다
- 팔레트와 여백, 글자 크기를 직접 정했다
- 스크린샷을 베껴 그린 아이콘이 없다
`;
}
