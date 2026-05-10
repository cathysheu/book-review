/* global React, ReactDOM, POSTS, CATEGORIES, PALETTES, PALETTES_DARK */
const { useState, useEffect, useMemo, useRef } = React;

const ADMIN_PASSWORD = "651213";
const LIBRARY_STORAGE_KEY = "blog.library.v3";
const ADMIN_SESSION_KEY = "blog.admin.authed";

/* ---------------- helpers ---------------- */
const fmtDate = (iso) => {
  const d = new Date(iso);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[d.getMonth()] || ""} ${String(d.getDate()).padStart(2,"0")} ${d.getFullYear()}`;
};

const fmtYear = (iso) => new Date(iso).getFullYear();

const escapeHtml = (str = "") => String(str)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const bodyToHtml = (body = []) => body
  .filter(Boolean)
  .map((para) => `<p>${escapeHtml(para)}</p>`)
  .join("");

const hashHue = (id) => {
  let n = 0;
  for (const ch of String(id || "")) n = (n * 31 + ch.charCodeAt(0)) % 360;
  return n || 140;
};

const comparePostsByDate = (a, b) => {
  const left = `${a.date || ""}T${a.time || "00:00"}`;
  const right = `${b.date || ""}T${b.time || "00:00"}`;
  return right.localeCompare(left);
};

const getNowParts = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}`
  };
};

const isSafeHref = (href) => /^(https?:|mailto:|\/)/i.test(href || "");

function sanitizeRichText(html = "") {
  if (typeof document === "undefined") return html || "";
  const template = document.createElement("template");
  template.innerHTML = html;
  const allowed = new Set(["A", "B", "BR", "EM", "I", "LI", "OL", "P", "STRONG", "U", "UL", "BLOCKQUOTE"]);

  const walk = (node) => {
    Array.from(node.childNodes).forEach((child) => {
      if (child.nodeType === Node.COMMENT_NODE) {
        child.remove();
        return;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) return;

      if (child.tagName === "IMG") {
        child.remove();
        return;
      }

      if (!allowed.has(child.tagName)) {
        const frag = document.createDocumentFragment();
        while (child.firstChild) frag.appendChild(child.firstChild);
        child.replaceWith(frag);
        walk(node);
        return;
      }

      if (child.tagName === "A") {
        const rawHref = child.getAttribute("href") || "";
        Array.from(child.attributes).forEach((attr) => child.removeAttribute(attr.name));
        if (!isSafeHref(rawHref)) {
          const frag = document.createDocumentFragment();
          while (child.firstChild) frag.appendChild(child.firstChild);
          child.replaceWith(frag);
          walk(node);
          return;
        }
        child.setAttribute("href", rawHref);
        child.setAttribute("target", "_blank");
        child.setAttribute("rel", "noreferrer noopener");
      } else {
        Array.from(child.attributes).forEach((attr) => child.removeAttribute(attr.name));
      }

      walk(child);
    });
  };

  walk(template.content);

  return template.innerHTML
    .replace(/<p>\s*<\/p>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function richTextToPlainText(html = "") {
  if (typeof document === "undefined") return String(html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const wrapper = document.createElement("div");
  wrapper.innerHTML = sanitizeRichText(html);
  return (wrapper.textContent || "")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function richTextToParagraphs(html = "") {
  if (typeof document === "undefined") {
    return String(html || "")
      .split(/\n{2,}/)
      .map((part) => part.trim())
      .filter(Boolean);
  }

  const wrapper = document.createElement("div");
  wrapper.innerHTML = sanitizeRichText(html);
  const blocks = [];

  Array.from(wrapper.children).forEach((child) => {
    const text = (child.textContent || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    if (text) blocks.push(text);
  });

  if (!blocks.length) {
    const fallback = (wrapper.textContent || "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    if (fallback) blocks.push(fallback);
  }

  return blocks;
}

function injectDropCap(html = "") {
  if (typeof document === "undefined") return html || "";
  const wrapper = document.createElement("div");
  wrapper.innerHTML = sanitizeRichText(html);
  const firstParagraph = wrapper.querySelector("p");
  if (!firstParagraph) return wrapper.innerHTML;

  const walk = (node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.textContent || "";
        const match = text.match(/^(\s*)([\s\S])([\s\S]*)$/u);
        if (!match) continue;
        const [, leading, firstChar, rest] = match;
        const frag = document.createDocumentFragment();
        if (leading) frag.appendChild(document.createTextNode(leading));
        const span = document.createElement("span");
        span.className = "dropcap-char";
        span.textContent = firstChar;
        frag.appendChild(span);
        if (rest) frag.appendChild(document.createTextNode(rest));
        child.replaceWith(frag);
        return true;
      }
      if (child.nodeType === Node.ELEMENT_NODE && walk(child)) return true;
    }
    return false;
  };

  walk(firstParagraph);
  return wrapper.innerHTML;
}

const excerptFromHtml = (html = "", max = 170) => {
  const text = richTextToPlainText(html);
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "…";
};

const getSearchText = (post) => {
  const bodyText = post.bodyHtml ? richTextToPlainText(post.bodyHtml) : (post.body || []).join(" ");
  return [post.title, post.author, post.excerpt, bodyText].filter(Boolean).join(" ").toLowerCase();
};

const ensurePostShape = (post) => {
  const safeBody = Array.isArray(post.body) ? post.body.filter(Boolean) : [];
  const safeBodyHtml = sanitizeRichText(post.bodyHtml || bodyToHtml(safeBody));
  const normalizedBody = safeBody.length ? safeBody : richTextToParagraphs(safeBodyHtml);
  return {
    ...post,
    author: post.author || "",
    category: post.category || "未分類",
    excerpt: post.excerpt || excerptFromHtml(safeBodyHtml),
    body: normalizedBody,
    bodyHtml: safeBodyHtml,
    cover: {
      hue: post.cover?.hue ?? hashHue(post.id),
      label: post.cover?.label || post.title || "書籍"
    }
  };
};

const clonePosts = (posts) => posts.map((post) => ensurePostShape(JSON.parse(JSON.stringify(post))));

function loadInitialLibrary() {
  const basePosts = clonePosts(window.POSTS || []);
  const baseCovers = { ...(window.COVER_IMAGES || {}) };

  try {
    const raw = localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) return { posts: basePosts, coverImages: baseCovers };
    const saved = JSON.parse(raw);
    if (!saved || !Array.isArray(saved.posts)) return { posts: basePosts, coverImages: baseCovers };
    return {
      posts: clonePosts(saved.posts).sort(comparePostsByDate),
      coverImages: { ...baseCovers, ...(saved.coverImages || {}) }
    };
  } catch {
    return { posts: basePosts, coverImages: baseCovers };
  }
}

function persistLibrary(posts, coverImages) {
  try {
    localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify({ posts, coverImages }));
  } catch {}
}

function getCategoryList(posts) {
  const existing = Array.isArray(window.CATEGORIES) ? window.CATEGORIES.filter((c) => c !== "全部") : [];
  const seen = new Set();
  const ordered = ["全部"];

  existing.forEach((cat) => {
    if (!seen.has(cat) && posts.some((post) => post.category === cat)) {
      ordered.push(cat);
      seen.add(cat);
    }
  });

  posts.forEach((post) => {
    if (post.category && !seen.has(post.category)) {
      ordered.push(post.category);
      seen.add(post.category);
    }
  });

  return ordered;
}

const makePostId = () => `local-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/* ---------------- icons ---------------- */
const Icon = {
  search: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>,
  bookmark: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill={p.filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6"><path d="M6 3h12v18l-6-4-6 4z"/></svg>,
  sun: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>,
  moon: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>,
  arrow: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M5 12h14M13 5l7 7-7 7"/></svg>,
  back: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" {...p}><path d="M19 12H5M11 19l-7-7 7-7"/></svg>,
  share: (p) => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" {...p}><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>,
  edit: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>,
  home: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5"/></svg>,
  plus: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="M12 5v14M5 12h14"/></svg>,
  trash: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/></svg>,
  link: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="M10 13a5 5 0 0 0 7.07 0l2.83-2.83a5 5 0 0 0-7.07-7.07L10 5"/><path d="M14 11a5 5 0 0 0-7.07 0L4.1 13.83a5 5 0 1 0 7.07 7.07L14 19"/></svg>,
  close: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><path d="m18 6-12 12M6 6l12 12"/></svg>,
  lock: (p) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" {...p}><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 1 1 8 0v4"/></svg>,
};

/* ---------------- Book cover SVG placeholder ---------------- */
function BookCover({ post, size = "md" }) {
  const img = window.COVER_IMAGES && window.COVER_IMAGES[post.id];
  const hue = post.cover.hue;
  const tint = `oklch(0.86 0.05 ${hue})`;
  const ink  = `oklch(0.32 0.06 ${hue})`;
  if (img) {
    return (
      <div className={`book-cover photo ${size === "lg" ? "lg" : ""}`}>
        <img src={img} alt={post.title} loading="lazy"/>
      </div>
    );
  }
  return (
    <div className={`book-cover ${size === "lg" ? "lg" : ""}`} style={{ background: tint, color: ink }}>
      <div className="stripes"></div>
      <div className="border"></div>
      <div className="label">{post.cover.label}</div>
    </div>
  );
}

/* ---------------- Header ---------------- */
function SiteHeader({ route, navigate, dark, setDark, onOpenAdmin }) {
  const items = [
    { key: "home", label: "首頁" },
    { key: "categories", label: "分類" },
    { key: "archive", label: "書目" },
    { key: "about", label: "關於" }
  ];
  return (
    <header className="site-header">
      <div className="container">
        <div className="brand" onClick={() => navigate({ name: "home" })} style={{ cursor: "pointer" }}>
          <span className="meta-line">CATHY · MAMA · 讀書筆記</span>
          <h1>凱西媽的書評</h1>
          <span className="tagline">經典書籍的閱讀分享 · since 2018</span>
        </div>
        <nav className="site-nav">
          {items.map((it) => (
            <a key={it.key}
               className={route.name === it.key ? "active" : ""}
               onClick={(e) => { e.preventDefault(); navigate({ name: it.key }); }}
               href="#">{it.label}</a>
          ))}
          <button className="icon-btn admin-btn" onClick={onOpenAdmin} title="管理書評">
            <Icon.lock/><span>管理</span>
          </button>
          <button className="icon-btn" onClick={() => setDark(!dark)} title={dark ? "切換為亮色" : "切換為暗色"}>
            {dark ? <Icon.sun/> : <Icon.moon/>}
          </button>
        </nav>
      </div>
    </header>
  );
}

/* ---------------- Hero (featured) ---------------- */
function Hero({ post, navigate }) {
  if (!post) return null;
  const hasAuthor = Boolean(post.author && post.author.trim());
  return (
    <section className="hero container" data-screen-label="Featured">
      <div>
        <div className="hero-tag">本期精選 · Featured</div>
        <h2 onClick={() => navigate({ name: "post", id: post.id })} style={{ cursor: "pointer" }}>
          {post.title}
        </h2>
        <div className="hero-meta">
          <span>{post.category}</span>
          <span className="dot"></span>
          <span>{fmtDate(post.date)}</span>
          {hasAuthor && <span className="dot"></span>}
          {hasAuthor && <span style={{fontStyle:"italic", textTransform:"none", letterSpacing:"0.05em", fontFamily:"var(--serif)", fontSize:13, color:"var(--ink-soft)"}}>{post.author}</span>}
        </div>
        <p>{post.excerpt}</p>
        <a className="read-more" href="#" onClick={(e) => { e.preventDefault(); navigate({ name: "post", id: post.id }); }}>
          繼續閱讀 <Icon.arrow/>
        </a>
      </div>
      <div style={{ display: "flex", justifyContent: "center" }}>
        <div style={{ width: 220, height: 330 }}>
          <BookCover post={post} size="lg"/>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Toolbar ---------------- */
function Toolbar({ category, setCategory, search, setSearch, sort, setSort }) {
  return (
    <section className="toolbar container">
      <div className="cat-tabs">
        {CATEGORIES.map((c) => (
          <button key={c}
                  className={category === c ? "on" : ""}
                  onClick={() => setCategory(c)}>{c}</button>
        ))}
      </div>
      <div className="tools-right">
        <div className="search-box">
          <Icon.search/>
          <input
            placeholder="搜尋書名、作者或內容…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select className="sort-select" value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="date-desc">最新發表</option>
          <option value="date-asc">最早發表</option>
          <option value="title">書名 A→Z</option>
          <option value="cat">依分類</option>
        </select>
      </div>
    </section>
  );
}

/* ---------------- Post card ---------------- */
function Card({ post, navigate, bookmarks, toggleBookmark }) {
  const isBm = bookmarks.includes(post.id);
  const hasAuthor = Boolean(post.author && post.author.trim());
  return (
    <article className="card" onClick={() => navigate({ name: "post", id: post.id })}>
      <div className="card-cover"><BookCover post={post}/></div>
      <div className="card-body">
        <div className="card-meta">
          <span>{post.category}</span>
          <span style={{ width: 3, height: 3, background: "var(--ink-faint)", borderRadius: "50%" }}></span>
          <span>{fmtDate(post.date)}</span>
        </div>
        <h3>{post.title}</h3>
        {hasAuthor && (
          <div className="card-meta" style={{ marginTop: -4, marginBottom: 10 }}>
            <span className="author">{post.author}</span>
          </div>
        )}
        <p className="card-excerpt">{post.excerpt}</p>
      </div>
      <button className={"bookmark-btn " + (isBm ? "on" : "")}
              onClick={(e) => { e.stopPropagation(); toggleBookmark(post.id); }}
              title={isBm ? "取消收藏" : "收藏"}>
        <Icon.bookmark filled={isBm}/>
      </button>
    </article>
  );
}

/* ---------------- Home ---------------- */
function Home({ navigate, bookmarks, toggleBookmark }) {
  const [category, setCategory] = useState("全部");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("date-desc");

  const filtered = useMemo(() => {
    let list = POSTS.slice();
    if (category !== "全部") list = list.filter((p) => p.category === category);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => getSearchText(p).includes(q));
    }
    if (sort === "date-desc") list.sort((a,b) => comparePostsByDate(a, b));
    else if (sort === "date-asc") list.sort((a,b) => comparePostsByDate(b, a));
    else if (sort === "title") list.sort((a,b) => a.title.localeCompare(b.title, "zh"));
    else if (sort === "cat") list.sort((a,b) => a.category.localeCompare(b.category, "zh") || comparePostsByDate(a, b));
    return list;
  }, [category, search, sort]);

  const featured = (category === "全部" && !search) ? POSTS.find((p) => p.featured) || POSTS[0] : null;
  const list = featured ? filtered.filter((p) => p.id !== featured.id) : filtered;

  return (
    <main data-screen-label="Home">
      {featured && <Hero post={featured} navigate={navigate}/>}
      <Toolbar category={category} setCategory={setCategory} search={search} setSearch={setSearch} sort={sort} setSort={setSort}/>
      <section className="feed container">
        {list.length === 0 ? (
          <div className="empty">沒有符合條件的文章。</div>
        ) : (
          list.map((p) => <Card key={p.id} post={p} navigate={navigate} bookmarks={bookmarks} toggleBookmark={toggleBookmark}/>)
        )}
      </section>
    </main>
  );
}

/* ---------------- Post page ---------------- */
function PostPage({ post, navigate, bookmarks, toggleBookmark, onEditPost }) {
  const ref = useRef(null);
  const [progress, setProgress] = useState(0);
  const hasAuthor = Boolean(post.author && post.author.trim());

  useEffect(() => {
    window.scrollTo({ top: 0 });
    const onScroll = () => {
      const el = ref.current;
      if (!el) return;
      const total = el.scrollHeight - window.innerHeight;
      const top = window.scrollY - el.offsetTop;
      const p = Math.max(0, Math.min(1, top / Math.max(1, total)));
      setProgress(p);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [post.id]);

  const isBm = bookmarks.includes(post.id);
  const idx = POSTS.findIndex((p) => p.id === post.id);
  const prev = POSTS[idx + 1];
  const next = POSTS[idx - 1];

  const renderedBodyHtml = useMemo(() => {
    if (!post.bodyHtml) return "";
    return injectDropCap(post.bodyHtml);
  }, [post.bodyHtml]);

  return (
    <main data-screen-label="Post">
      <div className="progress-rail"><div className="fill" style={{ width: `${progress * 100}%` }}></div></div>
      <article className="post-page" ref={ref}>
        <div className="post-topbar">
          <button className="post-back" onClick={() => navigate({ name: "home" })}>
            <Icon.back/> 回到首頁
          </button>
          <button className="post-edit-btn" onClick={() => onEditPost(post.id)} title="編輯書評">
            <Icon.edit/> 編輯
          </button>
        </div>
        <div className="post-cat">{post.category}</div>
        <h1 className="post-title">{post.title}</h1>
        {hasAuthor && <p className="post-author">— {post.author} 著</p>}
        <div className="post-meta">
          <span>{fmtDate(post.date)} · {post.time}</span>
          <span className="dot" style={{width:3,height:3,background:"var(--ink-faint)",borderRadius:"50%",display:"inline-block"}}></span>
          <span>凱西媽 撰</span>
        </div>
        <div className="post-body">
          <div className="post-body-cover"><BookCover post={post} size="lg"/></div>
          {post.bodyHtml ? (
            <div className="post-rich" dangerouslySetInnerHTML={{ __html: renderedBodyHtml }} />
          ) : (
            post.body.map((para, i) => <p key={i}>{para}</p>)
          )}
        </div>
        <div className="post-foot">
          <div className="post-actions">
            <button className={"btn " + (isBm ? "on" : "")} onClick={() => toggleBookmark(post.id)}>
              <Icon.bookmark filled={isBm}/> {isBm ? "已收藏" : "收藏"}
            </button>
            <button className="btn"><Icon.share/> 分享</button>
          </div>
          <div className="post-home-wrap">
            <button className="btn btn-home" onClick={() => navigate({ name: "home" })}>
              <Icon.home/> 回到首頁
            </button>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {prev && <button className="btn" onClick={() => navigate({ name: "post", id: prev.id })}>← {prev.title}</button>}
            {next && <button className="btn" onClick={() => navigate({ name: "post", id: next.id })}>{next.title} →</button>}
          </div>
        </div>
      </article>
    </main>
  );
}

/* ---------------- Categories page ---------------- */
function CategoriesPage({ navigate }) {
  const cats = CATEGORIES.filter((c) => c !== "全部").map((c) => {
    const posts = POSTS.filter((p) => p.category === c).sort(comparePostsByDate);
    return { name: c, count: posts.length, recent: posts[0] };
  });
  return (
    <main data-screen-label="Categories">
      <div className="page-head container">
        <div className="kicker">Categories · 文學分類</div>
        <h2>分類書架</h2>
        <div className="desc">依文學區域整理的閱讀筆記</div>
      </div>
      <div className="cat-grid container">
        {cats.map((c) => (
          <div className="cat-card" key={c.name} onClick={() => navigate({ name: "category", cat: c.name })}>
            <div className="cat-count">{String(c.count).padStart(2,"0")} 篇書評</div>
            <h3 className="cat-name">{c.name}</h3>
            {c.recent && <div className="cat-recent">最新：《{c.recent.title}》{c.recent.author ? `— ${c.recent.author}` : ""}</div>}
          </div>
        ))}
      </div>
    </main>
  );
}

/* ---------------- Single category ---------------- */
function CategoryPage({ cat, navigate, bookmarks, toggleBookmark }) {
  const list = POSTS.filter((p) => p.category === cat).sort(comparePostsByDate);
  return (
    <main data-screen-label={`Category ${cat}`}>
      <div className="page-head container">
        <div className="kicker">Category</div>
        <h2>{cat}</h2>
        <div className="desc">{list.length} 篇文章</div>
      </div>
      <section className="feed container">
        {list.map((p) => <Card key={p.id} post={p} navigate={navigate} bookmarks={bookmarks} toggleBookmark={toggleBookmark}/>)}
      </section>
    </main>
  );
}

/* ---------------- Archive ---------------- */
function ArchivePage({ navigate }) {
  const groups = useMemo(() => {
    const sorted = POSTS.slice().sort(comparePostsByDate);
    const g = {};
    sorted.forEach((p) => {
      const y = fmtYear(p.date);
      g[y] = g[y] || [];
      g[y].push(p);
    });
    return g;
  }, []);
  return (
    <main data-screen-label="Archive">
      <div className="page-head container">
        <div className="kicker">Archive · 書目索引</div>
        <h2>全部書評</h2>
        <div className="desc">{POSTS.length} 篇 · 按日期排序</div>
      </div>
      <div className="archive-list">
        {Object.keys(groups).sort((a,b) => b.localeCompare(a)).map((y) => (
          <div key={y}>
            <div className="archive-year">{y}</div>
            {groups[y].map((p) => (
              <div className="archive-row" key={p.id} onClick={() => navigate({ name: "post", id: p.id })}>
                <div className="ar-date">{fmtDate(p.date).slice(0,6).toUpperCase()}</div>
                <div className="ar-title">{p.title}</div>
                <div className="ar-author">{p.author}</div>
                <div className="ar-cat">{p.category}</div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
}

/* ---------------- About ---------------- */
function AboutPage({ bookmarks }) {
  const stats = [
    { num: POSTS.length, lbl: "Reviews" },
    { num: CATEGORIES.filter((c) => c !== "全部").length, lbl: "Categories" },
    { num: bookmarks.length, lbl: "Your bookmarks" },
    { num: 6, lbl: "Years writing" }
  ];
  return (
    <main className="about-wrap" data-screen-label="About">
      <div className="about-portrait">凱</div>
      <h2>關於凱西媽</h2>
      <div className="about-tag">「讀書是為了，能更溫柔地理解這個世界。」</div>
      <p>
        從 2018 年的某個午後開始，我習慣在讀完一本書之後，把當下浮現的想法寫成短短的筆記。原本只是為了不忘掉那個下午的閱讀感受，沒想到一寫就是六年，累積了上百篇散落的文字。
      </p>
      <p>
        這個小小的部落格，是這些筆記的家。沒有什麼書評的章法，也談不上文學評論的高度，只是一個讀者誠實的、片面的、有時候帶點偏心的閱讀心得；如果讀到的人剛好也喜歡這本書，或被勾起想讀的念頭，那就是這些筆記最美好的去處了。
      </p>
      <div className="stat-row">
        {stats.map((s,i) => (
          <div className="stat" key={i}>
            <div className="num">{s.num}</div>
            <div className="lbl">{s.lbl}</div>
          </div>
        ))}
      </div>
      <p>
        最近常讀的方向是台灣當代小說、戰後西洋經典，以及二十世紀的日本文學。如果你也讀完了某一本書、想找個人聊聊，歡迎透過下方任何一種方式找到我。
      </p>
      <p style={{ fontFamily: "var(--sans)", fontSize: 12, letterSpacing: ".18em", textTransform: "uppercase", color: "var(--ink-faint)", textAlign: "center", marginTop: 36 }}>
        Cathy · cathy@example.tw · 台北
      </p>
    </main>
  );
}

/* ---------------- Admin ---------------- */
function AdminEditor({ html, onChange }) {
  const editorRef = useRef(null);

  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML !== html) editorRef.current.innerHTML = html || "";
  }, [html]);

  const sync = () => onChange(editorRef.current ? editorRef.current.innerHTML : "");

  const exec = (cmd, value = null) => {
    if (!editorRef.current) return;
    editorRef.current.focus();
    document.execCommand(cmd, false, value);
    sync();
  };

  const onLink = () => {
    const url = window.prompt("輸入連結網址（https://...）");
    if (!url) return;
    exec("createLink", url);
  };

  return (
    <div className="admin-editor-wrap">
      <div className="admin-editor-toolbar">
        <button type="button" className="editor-tool" onClick={() => exec("bold")} title="粗體">
          <strong>B</strong>
        </button>
        <button type="button" className="editor-tool" onClick={() => exec("italic")} title="斜體">
          <em>I</em>
        </button>
        <button type="button" className="editor-tool" onClick={onLink} title="加入連結">
          <Icon.link/>
        </button>
      </div>
      <div
        ref={editorRef}
        className="admin-editor"
        contentEditable
        suppressContentEditableWarning
        onInput={sync}
        onBlur={sync}
      />
    </div>
  );
}

function AdminModal({ open, onClose, posts, categories, coverImages, initialPost, onSavePost, onDeletePost }) {
  const [mode, setMode] = useState(initialPost ? "edit" : "create");
  const [selectedId, setSelectedId] = useState(initialPost?.id || null);
  const emptyDate = getNowParts();
  const [form, setForm] = useState({
    title: "",
    author: "",
    category: categories[0] || "台灣文學",
    date: emptyDate.date,
    time: emptyDate.time,
    reviewHtml: "<p></p>",
    coverImage: "",
    featured: false,
  });

  const sortedPosts = useMemo(() => posts.slice().sort(comparePostsByDate), [posts]);

  const loadForm = (post) => {
    const now = getNowParts();
    if (!post) {
      setMode("create");
      setSelectedId(null);
      setForm({
        title: "",
        author: "",
        category: categories.find((c) => c !== "全部") || "台灣文學",
        date: now.date,
        time: now.time,
        reviewHtml: "<p></p>",
        coverImage: "",
        featured: false,
      });
      return;
    }

    setMode("edit");
    setSelectedId(post.id);
    setForm({
      title: post.title || "",
      author: post.author || "",
      category: post.category || categories.find((c) => c !== "全部") || "台灣文學",
      date: post.date || now.date,
      time: post.time || now.time,
      reviewHtml: sanitizeRichText(post.bodyHtml || bodyToHtml(post.body || [])) || "<p></p>",
      coverImage: coverImages[post.id] || "",
      featured: Boolean(post.featured),
    });
  };

  useEffect(() => {
    if (open) loadForm(initialPost || null);
  }, [open, initialPost]);

  const handleSave = (e) => {
    e.preventDefault();
    const safeHtml = sanitizeRichText(form.reviewHtml);
    const paragraphs = richTextToParagraphs(safeHtml);

    if (!form.title.trim()) {
      window.alert("請輸入書名。");
      return;
    }
    if (!paragraphs.length) {
      window.alert("請輸入書評內容。");
      return;
    }

    const id = mode === "edit" ? selectedId : makePostId();
    const existing = mode === "edit" ? posts.find((p) => p.id === selectedId) : null;
    const post = ensurePostShape({
      ...(existing || {}),
      id,
      title: form.title.trim(),
      author: form.author.trim(),
      category: form.category.trim() || "未分類",
      date: form.date,
      time: form.time,
      excerpt: excerptFromHtml(safeHtml),
      body: paragraphs,
      bodyHtml: safeHtml,
      featured: form.featured,
      cover: {
        hue: existing?.cover?.hue ?? hashHue(id),
        label: form.title.trim(),
      }
    });

    onSavePost(post, form.coverImage);
  };

  const handleDelete = () => {
    if (mode !== "edit" || !selectedId) return;
    const password = window.prompt("請再次輸入密碼以刪除這篇書評");
    if (password === null) return;
    if (password !== ADMIN_PASSWORD) {
      window.alert("密碼錯誤。");
      return;
    }
    if (!window.confirm("確定要刪除這篇書評？")) return;
    onDeletePost(selectedId);
  };

  const onCoverChange = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setForm((curr) => ({ ...curr, coverImage: String(reader.result || "") }));
    reader.readAsDataURL(file);
  };

  if (!open) return null;

  return (
    <div className="admin-overlay" onClick={onClose}>
      <div className="admin-shell" onClick={(e) => e.stopPropagation()}>
        <aside className="admin-sidebar">
          <div className="admin-sidebar-head">
            <h3>管理書評</h3>
            <button type="button" className="admin-close" onClick={onClose}>
              <Icon.close/>
            </button>
          </div>
          <button type="button" className="admin-create-btn" onClick={() => loadForm(null)}>
            <Icon.plus/> 新增書評
          </button>
          <div className="admin-post-list">
            {sortedPosts.map((post) => (
              <button
                type="button"
                key={post.id}
                className={"admin-post-item " + (selectedId === post.id ? "active" : "")}
                onClick={() => loadForm(post)}
              >
                <span>{post.title}</span>
                <small>{post.date}</small>
              </button>
            ))}
          </div>
        </aside>

        <form className="admin-main" onSubmit={handleSave}>
          <div className="admin-main-head">
            <div>
              <div className="admin-kicker">{mode === "edit" ? "編輯書評" : "新增書評"}</div>
              <h3>{mode === "edit" ? form.title || "未命名書評" : "新增書評"}</h3>
            </div>
            <div className="admin-head-actions">
              {mode === "edit" && (
                <button type="button" className="admin-danger-btn" onClick={handleDelete}>
                  <Icon.trash/> 刪除
                </button>
              )}
              <button type="submit" className="admin-save-btn">儲存</button>
            </div>
          </div>

          <div className="admin-grid">
            <label className="admin-field">
              <span>書名</span>
              <input value={form.title} onChange={(e) => setForm((curr) => ({ ...curr, title: e.target.value }))}/>
            </label>
            <label className="admin-field">
              <span>作者</span>
              <input value={form.author} onChange={(e) => setForm((curr) => ({ ...curr, author: e.target.value }))}/>
            </label>
            <label className="admin-field">
              <span>分類</span>
              <input list="category-options" value={form.category} onChange={(e) => setForm((curr) => ({ ...curr, category: e.target.value }))}/>
              <datalist id="category-options">
                {categories.filter((cat) => cat !== "全部").map((cat) => <option key={cat} value={cat}/>)}
              </datalist>
            </label>
            <label className="admin-field">
              <span>日期</span>
              <input type="date" value={form.date} onChange={(e) => setForm((curr) => ({ ...curr, date: e.target.value }))}/>
            </label>
            <label className="admin-field">
              <span>時間</span>
              <input type="time" value={form.time} onChange={(e) => setForm((curr) => ({ ...curr, time: e.target.value }))}/>
            </label>
            <label className="admin-check">
              <input type="checkbox" checked={form.featured} onChange={(e) => setForm((curr) => ({ ...curr, featured: e.target.checked }))}/>
              <span>設為精選</span>
            </label>
          </div>

          <div className="admin-cover-field">
            <span>書封圖片</span>
            <div className="admin-cover-row">
              <label className="admin-upload-btn">
                上傳圖片
                <input type="file" accept="image/*" onChange={onCoverChange}/>
              </label>
              {form.coverImage && (
                <button type="button" className="admin-clear-btn" onClick={() => setForm((curr) => ({ ...curr, coverImage: "" }))}>
                  清除圖片
                </button>
              )}
            </div>
            {form.coverImage && (
              <div className="admin-cover-preview">
                <img src={form.coverImage} alt={form.title || "書封預覽"} />
              </div>
            )}
          </div>

          <label className="admin-field admin-field-full">
            <span>書評內容</span>
            <AdminEditor html={form.reviewHtml} onChange={(value) => setForm((curr) => ({ ...curr, reviewHtml: value }))}/>
          </label>
        </form>
      </div>
    </div>
  );
}

/* ---------------- Footer ---------------- */
function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="quote">「不說明就不會懂的事，是怎麼說明也不懂的事。」</div>
        <div>© 2018–2026 凱西媽的書評 · A reading-room journal</div>
      </div>
    </footer>
  );
}

/* ---------------- App ---------------- */
function App() {
  const initialLibrary = useMemo(() => loadInitialLibrary(), []);
  const [route, setRoute] = useState({ name: "home" });
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem("blog.dark") === "1"; } catch { return false; }
  });
  const [bookmarks, setBookmarks] = useState(() => {
    try { return JSON.parse(localStorage.getItem("blog.bookmarks") || "[]"); } catch { return []; }
  });
  const [posts, setPosts] = useState(initialLibrary.posts);
  const [coverImages, setCoverImages] = useState(initialLibrary.coverImages);
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminTargetId, setAdminTargetId] = useState(null);

  const categories = useMemo(() => getCategoryList(posts), [posts]);
  window.POSTS = posts;
  window.COVER_IMAGES = coverImages;
  window.CATEGORIES = categories;

  useEffect(() => {
    persistLibrary(posts, coverImages);
  }, [posts, coverImages]);

  useEffect(() => {
    const pal = (dark ? PALETTES_DARK : PALETTES).forest || (dark ? PALETTES_DARK.cream : PALETTES.cream);
    const root = document.documentElement;
    Object.entries(pal).forEach(([k, v]) => {
      const map = { bg: "--bg", bgAlt: "--bg-alt", surface: "--surface", ink: "--ink", inkSoft: "--ink-soft", inkFaint: "--ink-faint", rule: "--rule", accent: "--accent" };
      if (map[k]) root.style.setProperty(map[k], v);
    });
    document.body.classList.toggle("dark", dark);
  }, [dark]);

  useEffect(() => { try { localStorage.setItem("blog.dark", dark ? "1" : "0"); } catch {} }, [dark]);
  useEffect(() => { try { localStorage.setItem("blog.bookmarks", JSON.stringify(bookmarks)); } catch {} }, [bookmarks]);

  const requireAdmin = () => {
    try {
      if (sessionStorage.getItem(ADMIN_SESSION_KEY) === "1") return true;
    } catch {}
    const password = window.prompt("請輸入管理密碼");
    if (password === ADMIN_PASSWORD) {
      try { sessionStorage.setItem(ADMIN_SESSION_KEY, "1"); } catch {}
      return true;
    }
    if (password !== null) window.alert("密碼錯誤。");
    return false;
  };

  const navigate = (r) => { setRoute(r); window.scrollTo(0,0); };
  const toggleBookmark = (id) => setBookmarks((bm) => bm.includes(id) ? bm.filter((x) => x !== id) : [...bm, id]);

  const openAdmin = (postId = null) => {
    if (!requireAdmin()) return;
    setAdminTargetId(postId);
    setAdminOpen(true);
  };

  const closeAdmin = () => {
    setAdminOpen(false);
    setAdminTargetId(null);
  };

  const savePost = (post, coverImage) => {
    const normalized = ensurePostShape(post);
    setPosts((prev) => {
      const exists = prev.some((item) => item.id === normalized.id);
      const next = exists
        ? prev.map((item) => item.id === normalized.id ? normalized : item)
        : [normalized, ...prev];
      return next.slice().sort(comparePostsByDate);
    });
    setCoverImages((prev) => {
      const next = { ...prev };
      if (coverImage) next[normalized.id] = coverImage;
      return next;
    });
    closeAdmin();
    navigate({ name: "post", id: normalized.id });
  };

  const deletePost = (id) => {
    setPosts((prev) => prev.filter((post) => post.id !== id));
    setCoverImages((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    closeAdmin();
    if (route.name === "post" && route.id === id) navigate({ name: "home" });
  };

  const adminTargetPost = adminTargetId ? posts.find((post) => post.id === adminTargetId) || null : null;

  let content;
  if (route.name === "home") content = <Home navigate={navigate} bookmarks={bookmarks} toggleBookmark={toggleBookmark}/>;
  else if (route.name === "post") {
    const post = posts.find((p) => p.id === route.id) || posts[0];
    content = <PostPage post={post} navigate={navigate} bookmarks={bookmarks} toggleBookmark={toggleBookmark} onEditPost={openAdmin}/>;
  }
  else if (route.name === "categories") content = <CategoriesPage navigate={navigate}/>;
  else if (route.name === "category") content = <CategoryPage cat={route.cat} navigate={navigate} bookmarks={bookmarks} toggleBookmark={toggleBookmark}/>;
  else if (route.name === "archive") content = <ArchivePage navigate={navigate}/>;
  else if (route.name === "about") content = <AboutPage bookmarks={bookmarks}/>;

  return (
    <>
      <SiteHeader route={route} navigate={navigate} dark={dark} setDark={setDark} onOpenAdmin={() => openAdmin(null)}/>
      {content}
      <SiteFooter/>
      <AdminModal
        open={adminOpen}
        onClose={closeAdmin}
        posts={posts}
        categories={categories}
        coverImages={coverImages}
        initialPost={adminTargetPost}
        onSavePost={savePost}
        onDeletePost={deletePost}
      />
    </>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(<App/>);
