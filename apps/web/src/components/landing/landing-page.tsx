"use client";

import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type CSSProperties,
  type ReactNode,
} from "react";
import { TemplatePreview } from "./template-preview";
import { useLandingMotion } from "./use-landing-motion";
import {
  categoryStyles,
  rupiah,
  templates,
  type Category,
  type Template,
} from "./templates";

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return (
    <svg
      className="arrow-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d={diagonal ? "M6 18 18 6M6 6h12v12" : "M4 12h16m-6-6 6 6-6 6"} />
    </svg>
  );
}

function Spark({ className = "" }: { className?: string }) {
  return (
    <svg
      className={`spark-icon ${className}`}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M20 0v40M0 20h40M6 6l28 28M6 34 34 6"
        stroke="currentColor"
        strokeWidth="4"
      />
    </svg>
  );
}

/** Words rise from behind a clipping line on load; text stays readable without motion. */
function HeadlineWords({ words, start }: { words: string[]; start: number }) {
  return (
    <span className="headline-mask">
      {words.map((word, index) => (
        <Fragment key={word}>
          {index > 0 && " "}
          <span
            className="headline-word"
            style={{ "--word-index": start + index } as CSSProperties}
          >
            {word}
          </span>
        </Fragment>
      ))}
    </span>
  );
}

function ScrollWords({ text }: { text: string }) {
  return text.split(" ").map((word, index) => (
    <Fragment key={`${word}-${index}`}>
      <span className="scroll-word">{word}</span>{" "}
    </Fragment>
  ));
}

const FilterContext = createContext<{ selectCategory: (slug: string) => void }>(
  { selectCategory: () => {} },
);

const subscribeNothing = () => () => {};

export function CategoryTiles({ categories }: { categories: Category[] }) {
  const { selectCategory } = useContext(FilterContext);
  // Streamed tiles hydrate after the page; motion waits so it never edits
  // server HTML that React has not claimed yet.
  const hydrated = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  return (
    <div className="category-grid" data-hydrated={hydrated ? "" : undefined}>
      {categories.map((category, index) => {
        const style = categoryStyles[category.slug];
        return (
          <button
            className={`category-tile tone-${style?.tone ?? "sage"}`}
            key={category.id}
            onClick={() => selectCategory(category.slug)}
          >
            <div className="category-topline">
              <span>0{index + 1} / JELAJAHI</span>
              <Arrow diagonal />
            </div>
            <div className="category-mini">
              <TemplatePreview template={templates[style?.template ?? 0]} />
            </div>
            <h3>{style?.label ?? category.name}</h3>
            <p>{style?.note ?? category.name}</p>
          </button>
        );
      })}
    </div>
  );
}

const filters = [
  { slug: "all", label: "Semua" },
  { slug: "portfolio", label: "Portfolio" },
  { slug: "business", label: "Bisnis" },
  { slug: "ecommerce", label: "Toko online" },
  { slug: "landing-page", label: "Landing page" },
];
const heroTemplates = [
  templates[4],
  templates[2],
  templates[0],
  templates[3],
  templates[1],
];
const steps = [
  {
    title: "Temukan yang terasa Anda.",
    text: "Jelajahi desain, lihat pratinjau, dan temukan teknologi yang sesuai dengan rencana Anda.",
    detail:
      "Perhatikan teknologi, kebutuhan instalasi, isi file, dan lisensi sebelum memilih sebuah template.",
  },
  {
    title: "Satu pembayaran. Banyak kemungkinan.",
    text: "Pilih template favorit dan periksa detail pembelian sebelum melanjutkan pembayaran.",
    detail:
      "Alur pembelian dirancang menggunakan Midtrans dengan pilihan QRIS, virtual account, dan e-wallet. Pembayaran belum diaktifkan pada pratinjau desain ini.",
  },
  {
    title: "Unduh. Ubah. Jadikan milik Anda.",
    text: "Mulai dari fondasi yang sudah ada, lalu tambahkan warna, cerita, dan karakter Anda sendiri.",
    detail:
      "Template direncanakan tersedia sebagai file ZIP. Hosting, domain, dan bantuan instalasi disiapkan terpisah sesuai kebutuhan Anda.",
  },
];

export function LandingPage({ categories }: { categories: ReactNode }) {
  const [activeCategory, setActiveCategory] = useState("all");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const [selected, setSelected] = useState<Template | null>(null);
  const [info, setInfo] = useState<"account" | "seller" | "license" | null>(
    null,
  );
  const [openStep, setOpenStep] = useState<number | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const infoRef = useRef<HTMLDialogElement>(null);
  const landingRef = useRef<HTMLDivElement>(null);
  useLandingMotion(landingRef, motionPaused);

  useEffect(() => {
    if (selected && !dialogRef.current?.open) dialogRef.current?.showModal();
    if (!selected && dialogRef.current?.open) dialogRef.current.close();
  }, [selected]);
  useEffect(() => {
    if (info && !infoRef.current?.open) infoRef.current?.showModal();
    if (!info && infoRef.current?.open) infoRef.current.close();
  }, [info]);

  function scrollToCollection() {
    document.getElementById("koleksi")?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
    });
    setMobileOpen(false);
  }
  function selectCategory(slug: string) {
    setActiveCategory(slug);
    setQuery("");
    setSearch("");
    scrollToCollection();
  }
  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(query.trim());
    setActiveCategory("all");
    scrollToCollection();
  }
  const matchingTemplates = templates.filter((template) => {
    const haystack =
      `${template.name} ${template.title} ${template.categoryLabel} ${template.technology} ${template.seller}`.toLowerCase();
    return (
      (activeCategory === "all" || template.category === activeCategory) &&
      search
        .toLowerCase()
        .split(/\s+/)
        .every((word) => haystack.includes(word))
    );
  });

  return (
    <FilterContext.Provider value={{ selectCategory }}>
      <a className="skip-link" href="#konten">
        Langsung ke konten
      </a>
      <div
        id="atas"
        className="landing"
        ref={landingRef}
        data-motion-paused={motionPaused ? "true" : undefined}
      >
        <div className="scroll-progress" aria-hidden="true" />
        <button
          className="motion-control"
          onClick={() => setMotionPaused(!motionPaused)}
          aria-pressed={motionPaused}
        >
          <span
            className={`motion-control-icon ${motionPaused ? "is-paused" : ""}`}
            aria-hidden="true"
          >
            <span />
            <span />
            <span />
          </span>
          {motionPaused ? "Lanjutkan animasi" : "Jeda animasi"}
        </button>
        <section className="hero">
          <div className="hero-grid" aria-hidden="true">
            <span className="hero-grid-spot" />
          </div>
          <header className="site-header container">
            <a href="#atas" aria-label="JD Sign — beranda">
              <span className="wordmark">
                <span>JD</span> SIGN<span className="logo-dot">®</span>
              </span>
            </a>
            <nav className="desktop-nav" aria-label="Navigasi utama">
              <a href="#koleksi">Template</a>
              <a href="#kategori">Kategori</a>
              <a href="#cara-pembelian">Cara pembelian</a>
              <a href="#kreator">
                Untuk kreator <Arrow diagonal />
              </a>
            </nav>
            <div className="header-actions">
              <button className="login-link" onClick={() => setInfo("account")}>
                Masuk <Arrow diagonal />
              </button>
              <a className="button button-lime button-small" href="#koleksi">
                Jelajahi koleksi <Arrow />
              </a>
              <button
                className="menu-toggle"
                aria-label={mobileOpen ? "Tutup menu" : "Buka menu"}
                aria-expanded={mobileOpen}
                aria-controls="mobile-nav"
                onClick={() => setMobileOpen(!mobileOpen)}
              >
                {mobileOpen ? (
                  "✕"
                ) : (
                  <>
                    <span />
                    <span />
                  </>
                )}
              </button>
            </div>
            {mobileOpen && (
              <nav
                id="mobile-nav"
                className="mobile-nav"
                aria-label="Navigasi seluler"
              >
                {[
                  ["#koleksi", "Template"],
                  ["#kategori", "Kategori"],
                  ["#cara-pembelian", "Cara pembelian"],
                  ["#kreator", "Untuk kreator"],
                ].map(([href, label]) => (
                  <a
                    key={href}
                    href={href}
                    onClick={() => setMobileOpen(false)}
                  >
                    {label}
                    <Arrow diagonal />
                  </a>
                ))}
                <button
                  onClick={() => {
                    setInfo("account");
                    setMobileOpen(false);
                  }}
                >
                  Masuk <Arrow diagonal />
                </button>
              </nav>
            )}
          </header>
          <div id="konten" className="hero-body container">
            <div className="hero-eyebrow">
              <span className="status-dot" /> DESAIN INDEPENDEN. IDE TANPA
              BATAS.
            </div>
            <h1>
              <span className="headline-first">
                <HeadlineWords words={["Template", "untuk"]} start={0} />
              </span>
              <span className="headline-second">
                <HeadlineWords words={["ide", "yang"]} start={2} />
                <span className="creator-avatars" aria-hidden="true">
                  <span>sa</span>
                  <span>kd</span>
                  <span>os</span>
                  <span>
                    <Spark />
                  </span>
                </span>
                <span className="lime-text headline-accent">
                  <HeadlineWords words={["berani."]} start={4} />
                  <svg
                    className="headline-scribble"
                    viewBox="0 0 320 20"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path
                      pathLength={1}
                      d="M4 12C60 4 150 2 316 8M34 17C120 11 220 10 294 14"
                    />
                  </svg>
                </span>
              </span>
            </h1>
            <p className="hero-description">
              Titik awal untuk sesuatu yang luar biasa. Temukan template
              <br className="desktop-break" /> website dari kreator lokal, lalu
              jadikan sepenuhnya milik Anda.
            </p>
            <form className="hero-search" onSubmit={submitSearch} role="search">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="m16 16 5 5" />
              </svg>
              <label className="sr-only" htmlFor="template-search">
                Cari contoh template
              </label>
              <input
                id="template-search"
                name="q"
                type="search"
                maxLength={100}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Coba ‘landing page’ atau ‘portfolio’"
              />
              <button type="submit">
                Cari template <Arrow />
              </button>
            </form>
            <div className="popular-searches">
              <span>Cari inspirasi:</span>
              {[
                { label: "Portfolio", slug: "portfolio" },
                { label: "Toko online", slug: "ecommerce" },
                { label: "Company profile", slug: "business" },
                { label: "Landing page", slug: "landing-page" },
              ].map((item) => (
                <button
                  key={item.slug}
                  onClick={() => selectCategory(item.slug)}
                >
                  {item.label} <span>↗</span>
                </button>
              ))}
            </div>
            <div className="hero-showcase">
              <div className="showcase-note">
                <span className="note-spark">
                  <Spark />
                </span>
                <div>
                  Ide Anda berikutnya
                  <br />
                  <strong>bisa mulai dari sini.</strong>
                </div>
                <svg
                  className="handdrawn-arrow"
                  viewBox="0 0 100 60"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    pathLength={1}
                    d="M5 8c15 45 50 40 83 16m-5-12 9 10-2 15"
                    stroke="currentColor"
                    strokeWidth="1.5"
                  />
                </svg>
              </div>
              <div className="showcase-fan" aria-label="Contoh desain template">
                {heroTemplates.map((template, index) => (
                  <button
                    key={template.id}
                    className={`fan-card fan-card-${index}`}
                    onClick={() => setSelected(template)}
                    aria-label={`Lihat contoh ${template.name}`}
                  >
                    <div className="fan-card-motion">
                      <TemplatePreview template={template} />
                      <div className="fan-caption">
                        <span>{template.name}</span>
                        <Arrow diagonal />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
              <div className="showcase-sticker">
                <Spark />
                <span>
                  BUAT JADI
                  <br />
                  <strong>milikmu.</strong>
                </span>
                <Arrow diagonal />
              </div>
            </div>
          </div>
        </section>
        <div className="category-ribbon" aria-label="Jenis template">
          <div className="ribbon-track">
            {[0, 1].map((copy) => (
              <div
                className="ribbon-group"
                key={copy}
                aria-hidden={copy === 1 ? true : undefined}
              >
                {[
                  "Portfolio",
                  "Bisnis & agensi",
                  "Toko online",
                  "Landing page",
                  "Ide tanpa batas",
                ].map((item) => (
                  <span key={item}>
                    {item}
                    <Spark />
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>

        <main>
          <section
            id="koleksi"
            className="collection section-pad container"
            aria-labelledby="collection-heading"
          >
            <div className="section-eyebrow">
              <span className="eyebrow-wipe">01 — TEMUKAN INSPIRASI</span>
              <span className="demo-label">
                <span /> KOLEKSI CONTOH
              </span>
            </div>
            <div className="section-heading-row">
              <h2 id="collection-heading" data-scroll-text="">
                <ScrollWords text="Desain pilihan," />
                <br />
                <span className="muted-text">
                  <ScrollWords text="siap untuk ide berikutnya." />
                </span>
              </h2>
              <p>
                Lebih sedikit mulai dari nol.
                <br />
                Lebih banyak ruang untuk berkarya.
              </p>
            </div>
            <div className="collection-toolbar">
              <div
                className="filter-tabs"
                role="group"
                aria-label="Filter kategori template"
              >
                {filters.map((filter) => (
                  <button
                    aria-pressed={activeCategory === filter.slug}
                    className={activeCategory === filter.slug ? "active" : ""}
                    key={filter.slug}
                    onClick={() => {
                      setActiveCategory(filter.slug);
                      setSearch("");
                      setQuery("");
                    }}
                  >
                    {filter.label}
                    {filter.slug === "all" && <span>06</span>}
                  </button>
                ))}
              </div>
              <span className="result-count" aria-live="polite">
                {matchingTemplates.length} desain untuk dijelajahi
              </span>
            </div>
            {search && (
              <p className="search-summary">
                Hasil pencarian untuk <strong>“{search}”</strong>
                <button
                  onClick={() => {
                    setSearch("");
                    setQuery("");
                  }}
                >
                  Hapus pencarian ×
                </button>
              </p>
            )}
            <div className="template-grid">
              {matchingTemplates.map((template, index) => (
                <button
                  className="template-card"
                  key={template.id}
                  onClick={() => setSelected(template)}
                  aria-label={`Lihat contoh ${template.name} — ${template.title}`}
                >
                  <div className="card-image">
                    <TemplatePreview template={template} />
                    <span className="preview-overlay">
                      Lihat desain <Arrow diagonal />
                    </span>
                    {index === 0 && activeCategory === "all" && !search && (
                      <span className="curator-label">
                        <Spark /> Pilihan desain
                      </span>
                    )}
                  </div>
                  <div className="card-details">
                    <div className="card-category">
                      <span>{template.categoryLabel}</span>
                      <span className="card-open">
                        <Arrow diagonal />
                      </span>
                    </div>
                    <h3>
                      {template.name} <span>— {template.title}</span>
                    </h3>
                    <p>oleh {template.seller}</p>
                    <div className="card-bottom">
                      <span>{template.technology}</span>
                      <strong>{rupiah(template.price)}</strong>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {matchingTemplates.length === 0 && (
              <div className="empty-state">
                <Spark />
                <h3>Ide Anda mungkin butuh arah baru.</h3>
                <p>Belum ada contoh desain yang cocok dengan pencarian ini.</p>
                <button
                  className="button button-dark"
                  onClick={() => selectCategory("all")}
                >
                  Lihat semua contoh <Arrow />
                </button>
              </div>
            )}
            <div className="collection-footer">
              <p>
                Desain dan harga di atas adalah contoh dari mockup. Belum
                tersedia untuk dibeli.
              </p>
              <button
                className="button button-outline"
                onClick={() => selectCategory("all")}
              >
                Jelajahi semua desain <Arrow />
              </button>
            </div>
          </section>
          <section
            id="kategori"
            className="categories-section section-pad"
            aria-labelledby="category-heading"
          >
            <div className="container">
              <div className="section-eyebrow">
                <span className="eyebrow-wipe">
                  02 — BANYAK CARA UNTUK MEMULAI
                </span>
              </div>
              <div className="section-heading-row">
                <h2 id="category-heading" data-scroll-text="">
                  <ScrollWords text="Banyak arah." />
                  <br />
                  <ScrollWords text="Pilih yang terasa tepat." />
                </h2>
                <p>
                  Dari karya pribadi sampai bisnis berikutnya.
                  <br />
                  Ada titik awal untuk setiap rencana.
                </p>
              </div>
              {categories}
            </div>
          </section>
          <section
            id="cara-pembelian"
            className="how-section section-pad container"
            aria-labelledby="how-heading"
          >
            <div className="how-layout">
              <div className="how-intro">
                <div className="section-eyebrow">
                  <span className="eyebrow-wipe">03 — DARI IDE JADI NYATA</span>
                </div>
                <h2 id="how-heading" data-scroll-text="">
                  <ScrollWords text="Pilih. Bayar." />
                  <br />
                  <span className="muted-text">
                    <ScrollWords text="Unduh." />
                  </span>
                  <Spark />
                </h2>
                <p>
                  Jalan yang lebih pendek dari menemukan desain hingga memulai
                  website Anda sendiri.
                </p>
                <span className="small-note">
                  Hosting, domain, dan instalasi disiapkan terpisah.
                </span>
              </div>
              <div className="steps">
                {steps.map((step, index) => (
                  <div className="step" key={step.title}>
                    <span className="step-number">0{index + 1}</span>
                    <div>
                      <button
                        className="step-toggle"
                        onClick={() =>
                          setOpenStep(openStep === index ? null : index)
                        }
                        aria-expanded={openStep === index}
                        aria-controls={`step-${index}`}
                      >
                        <h3>{step.title}</h3>
                        <span>{openStep === index ? "−" : "+"}</span>
                      </button>
                      <p>{step.text}</p>
                      <div
                        id={`step-${index}`}
                        hidden={openStep !== index}
                        className="step-detail"
                      >
                        {step.detail}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="benefit-strip">
              {[
                ["01", "Beli sekali", "Tanpa biaya langganan"],
                ["{ }", "File sumber", "Ruang penuh untuk berkreasi"],
                ["↗", "Siap dikembangkan", "Mulai dari fondasi pilihan"],
                ["ID", "Kreator lokal", "Ide baik dari Indonesia"],
              ].map(([symbol, title, text]) => (
                <div key={title}>
                  <span className="benefit-symbol">{symbol}</span>
                  <strong>{title}</strong>
                  <span>{text}</span>
                </div>
              ))}
            </div>
          </section>
          <section
            id="kreator"
            className="creator-section section-pad"
            aria-labelledby="creator-heading"
          >
            <div className="container creator-layout">
              <div className="creator-copy">
                <div className="section-eyebrow">
                  <span className="status-dot" />{" "}
                  <span className="eyebrow-wipe">04 — RUANG UNTUK KREATOR</span>
                </div>
                <h2 id="creator-heading" data-scroll-text="">
                  <ScrollWords text="Karya bagus" />
                  <br />
                  <ScrollWords text="layak menemukan" />
                  <br />
                  <span className="lime-text">
                    <ScrollWords text="lebih banyak orang." />
                  </span>
                </h2>
                <p>
                  Anda fokus membuat desain yang hebat.
                  <br />
                  Kami siapkan ruang untuk mempertemukannya
                  <br className="desktop-break" /> dengan ide besar berikutnya.
                </p>
                <ul className="creator-perks">
                  <li>
                    <span>↗</span> Etalase untuk karya dan identitas Anda
                  </li>
                  <li>
                    <span>↗</span> Template digital, kemungkinan tanpa batas
                  </li>
                  <li>
                    <span>↗</span> Tumbuh bersama kreator independen
                  </li>
                </ul>
                <button
                  className="button button-lime"
                  onClick={() => setInfo("seller")}
                >
                  Kenali ruang kreator <Arrow />
                </button>
              </div>
              <div className="creator-visual">
                <div className="creator-orbit orbit-one" />
                <div className="creator-orbit orbit-two" />
                <div className="creator-board">
                  <div className="board-header">
                    <span className="board-avatar">sa</span>
                    <div>
                      <strong>Studio Arunika</strong>
                      <span>Ruang kreator Anda</span>
                    </div>
                    <span className="board-menu">···</span>
                  </div>
                  <div className="board-label">DARI IDE, MENJADI KARYA.</div>
                  <h3>
                    Make good things.
                    <br />
                    <span>Let them be seen.</span>
                  </h3>
                  <div className="board-chart">
                    {[28, 43, 35, 62, 51, 79, 100].map((height, index) => (
                      <div key={index}>
                        <span style={{ height: `${height}%` }} />
                        <small>
                          {["S", "S", "R", "K", "J", "S", "M"][index]}
                        </small>
                      </div>
                    ))}
                  </div>
                  <div className="board-bottom">
                    <span>
                      <span className="status-dot" /> YOUR NEXT BIG THING
                    </span>
                    <Arrow diagonal />
                  </div>
                </div>
                <div className="floating-tag">
                  <Spark /> Desain lokal. Dampak luas.
                </div>
                <span className="creator-visual-caption">
                  ILUSTRASI RUANG KREATOR
                </span>
              </div>
            </div>
          </section>
          <section
            className="closing-section container"
            aria-labelledby="closing-heading"
          >
            <div className="closing-card">
              <Spark className="closing-spark" />
              <div className="section-eyebrow">
                <span className="eyebrow-wipe">SEKARANG, GILIRAN ANDA.</span>
              </div>
              <h2 id="closing-heading" data-scroll-text="">
                <ScrollWords text="Buat sesuatu" />
                <br />
                <ScrollWords text="yang berarti." />
              </h2>
              <p>
                Setiap ide besar butuh satu langkah pertama.
                <br />
                Desain berikutnya bisa jadi awal cerita Anda.
              </p>
              <a className="button button-dark" href="#koleksi">
                Temukan titik awal Anda <Arrow />
              </a>
              <span className="closing-coordinate">
                IDE BAIK DIMULAI DI SINI ↗
              </span>
            </div>
          </section>
        </main>
        <footer className="site-footer" id="footer">
          <div className="container">
            <div className="footer-top">
              <div className="footer-intro">
                <h3>
                  Ide berikutnya.
                  <br />
                  <span>Mulai pencarian di sini.</span>
                </h3>
                <form
                  onSubmit={submitSearch}
                  className="footer-search"
                  role="search"
                >
                  <label className="sr-only" htmlFor="footer-search">
                    Cari contoh template di footer
                  </label>
                  <input
                    id="footer-search"
                    type="search"
                    placeholder="Apa yang ingin Anda buat?"
                    maxLength={100}
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  <button aria-label="Cari template" type="submit">
                    <Arrow />
                  </button>
                </form>
              </div>
              <div className="footer-links">
                <div>
                  <span>JELAJAHI</span>
                  <a href="#koleksi">Semua desain</a>
                  <a href="#kategori">Kategori</a>
                  <a href="#kreator">Untuk kreator</a>
                </div>
                <div>
                  <span>KENALI</span>
                  <a href="#cara-pembelian">Cara pembelian</a>
                  <button onClick={() => setInfo("license")}>
                    Lisensi template
                  </button>
                  <button onClick={() => setInfo("seller")}>
                    Ruang kreator
                  </button>
                </div>
                <div>
                  <span>TERHUBUNG</span>
                  <button onClick={() => setInfo("account")}>
                    Akun Anda <Arrow diagonal />
                  </button>
                  <a href="#koleksi">
                    Cari inspirasi <Arrow diagonal />
                  </a>
                  <a href="#atas">
                    Kembali ke atas <span>↑</span>
                  </a>
                </div>
              </div>
            </div>
            <div className="giant-wordmark" role="img" aria-label="JD Sign">
              <div className="footer-logo-letters" aria-hidden="true">
                {["J", "D", "S", "I", "G", "N"].map((letter, index) => (
                  <span
                    className={`footer-letter ${index < 2 ? "is-lime" : ""} ${index === 2 ? "word-gap" : ""}`}
                    style={{ "--letter-index": index } as CSSProperties}
                    key={letter}
                  >
                    <span className="footer-letter-face" data-letter={letter}>
                      {letter}
                    </span>
                  </span>
                ))}
              </div>
              <span className="giant-spark" aria-hidden="true">
                <Spark />
              </span>
            </div>
            <div className="footer-bottom">
              <span>© 2026 JD Sign.</span>
              <span>Desain independen. Ide tanpa batas.</span>
              <a href="#atas">
                DIBUAT UNTUK IDE YANG BERANI <span>↗</span>
              </a>
            </div>
          </div>
        </footer>
      </div>
      <dialog
        className="template-dialog"
        ref={dialogRef}
        onCancel={() => setSelected(null)}
        onClose={() => setSelected(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setSelected(null);
        }}
        aria-labelledby="preview-title"
      >
        {selected && (
          <>
            <button
              className="dialog-close"
              onClick={() => setSelected(null)}
              aria-label="Tutup pratinjau"
            >
              ×
            </button>
            <TemplatePreview template={selected} />
            <div className="dialog-content">
              <span className="section-eyebrow">
                PRATINJAU KONSEP · {selected.categoryLabel}
              </span>
              <h2 id="preview-title">{selected.name}</h2>
              <p>
                {selected.title} oleh {selected.seller}.
              </p>
              <div className="dialog-product-meta">
                <span>{selected.technology}</span>
                <strong>{rupiah(selected.price)}</strong>
              </div>
              <p className="dialog-note">
                Ini adalah contoh desain dari mockup JD Sign. Harga bersifat
                ilustratif; template ini belum tersedia untuk dibeli.
              </p>
              <button
                className="button button-dark"
                onClick={() => setSelected(null)}
              >
                Kembali menjelajahi <Arrow />
              </button>
            </div>
          </>
        )}
      </dialog>
      <dialog
        className="info-dialog"
        ref={infoRef}
        onCancel={() => setInfo(null)}
        onClose={() => setInfo(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setInfo(null);
        }}
        aria-labelledby="info-title"
      >
        <button
          className="dialog-close"
          onClick={() => setInfo(null)}
          aria-label="Tutup informasi"
        >
          ×
        </button>
        <Spark />
        <span className="section-eyebrow">JD SIGN · LANGKAH BERIKUTNYA</span>
        <h2 id="info-title">
          {info === "account"
            ? "Ruang Anda, segera hadir."
            : info === "seller"
              ? "Punya karya untuk dibagikan?"
              : "Karya Anda. Dengan batas yang jelas."}
        </h2>
        <p>
          {info === "account"
            ? "Fitur akun dan pembelian sedang disiapkan. Untuk saat ini, Anda bisa menjelajahi contoh desain dan menemukan arah website berikutnya."
            : info === "seller"
              ? "JD Sign sedang menyiapkan ruang bagi kreator untuk membuka toko dan membagikan template website. Pendaftaran penjual belum dibuka pada pratinjau ini."
              : "Setiap template akan memiliki ketentuan lisensi pada halaman produknya. Periksa hak penggunaan, jumlah proyek, dan aturan distribusi sebelum membeli. Koleksi saat ini adalah contoh desain."}
        </p>
        <button
          className="button button-dark"
          onClick={() => {
            setInfo(null);
            scrollToCollection();
          }}
        >
          Jelajahi contoh desain <Arrow />
        </button>
      </dialog>
    </FilterContext.Provider>
  );
}
