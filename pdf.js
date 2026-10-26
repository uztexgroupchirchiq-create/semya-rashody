/* MONEVA: генератор PDF-отчёта без библиотек и без интернета.
   Делает настоящий PDF: текст (шрифт Inter вшит), таблицы, круговую и столбчатую диаграммы векторами.
   Использование: MonevaPDF.build(data) → Promise<Blob>. Данные готовит приложение (index.html). */
(function (root) {
  'use strict';
  var PW = 595.28, PH = 841.89, MX = 40;

  function hex(c) { // '#rrggbb' -> [r,g,b] 0..1
    if (c.length === 4) c = '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
    var n = parseInt(c.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  function f2(n) { return (Math.round(n * 100) / 100).toString(); }
  function ascii(s) { var o = new Uint8Array(s.length); for (var i = 0; i < s.length; i++) o[i] = s.charCodeAt(i) & 255; return o; }
  function b64bytes(b64) { var bin = atob(b64), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function concat(chunks) {
    var n = 0, i; for (i = 0; i < chunks.length; i++) n += chunks[i].length;
    var out = new Uint8Array(n), p = 0;
    for (i = 0; i < chunks.length; i++) { out.set(chunks[i], p); p += chunks[i].length; }
    return out;
  }
  function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return Promise.resolve(null);
    try {
      var cs = new CompressionStream('deflate'), w = cs.writable.getWriter();
      w.write(bytes); w.close();
      return new Response(cs.readable).arrayBuffer().then(function (b) { return new Uint8Array(b); });
    } catch (e) { return Promise.resolve(null); }
  }

  /* ---------- шрифты ---------- */
  function Font(key, spec, resName) {
    this.key = key; this.spec = spec; this.res = resName; this.used = {}; // gid -> unicode
    this.map = spec.map;
  }
  Font.prototype.glyph = function (ch) {
    var cp = ch.codePointAt(0), g = this.map[cp];
    if (!g) { g = this.map[0x3F] || this.map[32] || [0, 500]; }
    return g;
  };
  Font.prototype.width = function (s, size) {
    var w = 0;
    for (var i = 0; i < s.length; i++) { var ch = s.charAt(i); w += (ch === '\n' ? [0, 0] : this.glyph(ch))[1]; }
    return w * size / 1000;
  };
  Font.prototype.encode = function (s) {
    var out = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i), g = this.glyph(ch), gid = g[0];
      if (!(gid in this.used)) this.used[gid] = ch.codePointAt(0);
      out += ('0000' + gid.toString(16)).slice(-4);
    }
    return out;
  };

  /* ---------- страница ---------- */
  function Page() { this.ops = []; }
  Page.prototype.raw = function (s) { this.ops.push(s); };

  function Doc(fonts, logo) {
    this.fonts = fonts; this.pages = []; this.logo = logo || null; this.cur = null;
    this.newPage();
  }
  Doc.prototype.newPage = function () { this.cur = new Page(); this.pages.push(this.cur); return this.cur; };
  function col(c) { var a = typeof c === 'string' ? hex(c) : c; return f2(a[0]) + ' ' + f2(a[1]) + ' ' + f2(a[2]); }
  // координаты сверху вниз
  Doc.prototype.rect = function (x, y, w, h, fill, stroke, lw, r) {
    var p = this.cur, Y = PH - y - h, op = '';
    if (fill) op += col(fill) + ' rg ';
    if (stroke) op += col(stroke) + ' RG ' + f2(lw || 0.6) + ' w ';
    var paint = fill && stroke ? 'B' : fill ? 'f' : 'S';
    if (r) {
      var k = 0.5523 * r;
      op += f2(x + r) + ' ' + f2(Y) + ' m ' + f2(x + w - r) + ' ' + f2(Y) + ' l ' +
        f2(x + w - r + k) + ' ' + f2(Y) + ' ' + f2(x + w) + ' ' + f2(Y + r - k) + ' ' + f2(x + w) + ' ' + f2(Y + r) + ' c ' +
        f2(x + w) + ' ' + f2(Y + h - r) + ' l ' +
        f2(x + w) + ' ' + f2(Y + h - r + k) + ' ' + f2(x + w - r + k) + ' ' + f2(Y + h) + ' ' + f2(x + w - r) + ' ' + f2(Y + h) + ' c ' +
        f2(x + r) + ' ' + f2(Y + h) + ' l ' +
        f2(x + r - k) + ' ' + f2(Y + h) + ' ' + f2(x) + ' ' + f2(Y + h - r + k) + ' ' + f2(x) + ' ' + f2(Y + h - r) + ' c ' +
        f2(x) + ' ' + f2(Y + r) + ' l ' +
        f2(x) + ' ' + f2(Y + r - k) + ' ' + f2(x + r - k) + ' ' + f2(Y) + ' ' + f2(x + r) + ' ' + f2(Y) + ' c h ' + paint;
    } else op += f2(x) + ' ' + f2(Y) + ' ' + f2(w) + ' ' + f2(h) + ' re ' + paint;
    p.raw(op);
  };
  Doc.prototype.line = function (x1, y1, x2, y2, c, lw, dash) {
    this.cur.raw((dash ? '[' + dash + '] 0 d ' : '') + col(c) + ' RG ' + f2(lw || 0.5) + ' w ' + f2(x1) + ' ' + f2(PH - y1) + ' m ' + f2(x2) + ' ' + f2(PH - y2) + ' l S' + (dash ? ' [] 0 d' : ''));
  };
  Doc.prototype.polyline = function (pts, c, lw) {
    var s = col(c) + ' RG ' + f2(lw) + ' w 1 j 1 J ';
    pts.forEach(function (p, i) { s += f2(p[0]) + ' ' + f2(PH - p[1]) + (i ? ' l ' : ' m '); });
    this.cur.raw(s + 'S');
  };
  Doc.prototype.circle = function (cx, cy, r, fill) {
    var k = 0.5523 * r, X = cx, Y = PH - cy;
    this.cur.raw(col(fill) + ' rg ' + f2(X + r) + ' ' + f2(Y) + ' m ' +
      f2(X + r) + ' ' + f2(Y + k) + ' ' + f2(X + k) + ' ' + f2(Y + r) + ' ' + f2(X) + ' ' + f2(Y + r) + ' c ' +
      f2(X - k) + ' ' + f2(Y + r) + ' ' + f2(X - r) + ' ' + f2(Y + k) + ' ' + f2(X - r) + ' ' + f2(Y) + ' c ' +
      f2(X - r) + ' ' + f2(Y - k) + ' ' + f2(X - k) + ' ' + f2(Y - r) + ' ' + f2(X) + ' ' + f2(Y - r) + ' c ' +
      f2(X + k) + ' ' + f2(Y - r) + ' ' + f2(X + r) + ' ' + f2(Y - k) + ' ' + f2(X + r) + ' ' + f2(Y) + ' c f');
  };
  // сегмент кольца; углы по часовой стрелке от верха, в радианах
  function arcPts(cx, cy, r, a0, a1) { // возвращает кривые Безье в PDF-координатах
    var segs = [], n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / (Math.PI / 2))), step = (a1 - a0) / n, i;
    function pt(a) { return [cx + r * Math.sin(a), PH - (cy - r * Math.cos(a))]; }
    for (i = 0; i < n; i++) {
      var s = a0 + i * step, e = s + step, k = 4 / 3 * Math.tan((e - s) / 4);
      var p0 = pt(s), p3 = pt(e);
      var p1 = [p0[0] + k * r * Math.cos(s), p0[1] - k * r * Math.sin(s)];   // касательная (PDF y вверх)
      var p2 = [p3[0] - k * r * Math.cos(e), p3[1] + k * r * Math.sin(e)];
      segs.push([p1, p2, p3]);
    }
    return { start: pt(a0), segs: segs };
  }
  Doc.prototype.ring = function (cx, cy, rOut, rIn, a0, a1, fill) {
    var full = Math.abs(a1 - a0) >= Math.PI * 2 - 0.0005, s = col(fill) + ' rg ', o, i, b;
    function curve(arc) { return arc.segs.map(function (g) { return f2(g[0][0]) + ' ' + f2(g[0][1]) + ' ' + f2(g[1][0]) + ' ' + f2(g[1][1]) + ' ' + f2(g[2][0]) + ' ' + f2(g[2][1]) + ' c '; }).join(''); }
    if (full) {
      o = arcPts(cx, cy, rOut, 0, Math.PI * 2); i = arcPts(cx, cy, rIn, Math.PI * 2, 0);
      s += f2(o.start[0]) + ' ' + f2(o.start[1]) + ' m ' + curve(o) + 'h ' + f2(i.start[0]) + ' ' + f2(i.start[1]) + ' m ' + curve(i) + 'h f*';
    } else {
      o = arcPts(cx, cy, rOut, a0, a1); i = arcPts(cx, cy, rIn, a1, a0);
      s += f2(o.start[0]) + ' ' + f2(o.start[1]) + ' m ' + curve(o) + f2(i.start[0]) + ' ' + f2(i.start[1]) + ' l ' + curve(i) + 'h f';
    }
    this.cur.raw(s);
  };
  // текст: align left|right|center; возвращает ширину
  Doc.prototype.text = function (str, x, y, size, o) {
    o = o || {};
    var f = this.fonts[o.bold ? 'bold' : 'regular'];
    str = String(str);
    var w = f.width(str, size), X = x;
    if (o.align === 'right') X = x - w; else if (o.align === 'center') X = x - w / 2;
    this.cur.raw('BT /' + f.res + ' ' + f2(size) + ' Tf ' + col(o.color || '#101a17') + ' rg ' + f2(X) + ' ' + f2(PH - y) + ' Td <' + f.encode(str) + '> Tj ET');
    return w;
  };
  Doc.prototype.width = function (str, size, bold) { return this.fonts[bold ? 'bold' : 'regular'].width(String(str), size); };
  Doc.prototype.fit = function (str, size, maxW, bold) {
    str = String(str);
    if (this.width(str, size, bold) <= maxW) return str;
    while (str.length > 1 && this.width(str + '…', size, bold) > maxW) str = str.slice(0, -1);
    return str.replace(/\s+$/, '') + '…';
  };
  Doc.prototype.wrap = function (str, size, maxW, maxLines, bold) {
    var words = String(str).split(/\s+/), lines = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (this.width(t, size, bold) <= maxW) cur = t;
      else { if (cur) lines.push(cur); cur = w; while (this.width(cur, size, bold) > maxW && cur.length > 1) { var k = cur.length; while (k > 1 && this.width(cur.slice(0, k), size, bold) > maxW) k--; lines.push(cur.slice(0, k)); cur = cur.slice(k); } }
    }, this);
    if (cur) lines.push(cur);
    if (maxLines && lines.length > maxLines) { lines = lines.slice(0, maxLines); lines[maxLines - 1] = this.fit(lines[maxLines - 1] + '…', size, maxW, bold); }
    return lines.length ? lines : [''];
  };
  Doc.prototype.image = function (x, y, w, h) { if (this.logo) this.cur.raw('q ' + f2(w) + ' 0 0 ' + f2(h) + ' ' + f2(x) + ' ' + f2(PH - y - h) + ' cm /Im1 Do Q'); };

  /* ---------- сборка файла ---------- */
  Doc.prototype.finish = function (meta) {
    var self = this, objs = [], zip = [];
    function add(body) { objs.push(body); return objs.length; } // номер = индекс+1
    function streamObj(dict, bytes) {
      var idx = add(null);
      zip.push(deflate(bytes).then(function (z) {
        var data = z || bytes;
        objs[idx - 1] = { dict: dict + (z ? ' /Filter /FlateDecode' : '') + ' /Length ' + data.length, data: data };
      }));
      return idx;
    }
    var catalog = add(null), pagesObj = add(null);
    var fontRefs = {};
    ['regular', 'bold'].forEach(function (k) {
      var f = self.fonts[k], sp = f.spec, ttf = b64bytes(sp.b64), tag = (k === 'bold' ? 'MNVBLD' : 'MNVREG') + '+Inter' + (k === 'bold' ? '-Bold' : '-Regular');
      var ff = streamObj('/Length1 ' + ttf.length, ttf);
      var bb = sp.bbox;
      var fd = add('<< /Type /FontDescriptor /FontName /' + tag + ' /Flags 4 /FontBBox [' + bb.join(' ') + '] /ItalicAngle 0 /Ascent ' + sp.asc + ' /Descent ' + sp.desc + ' /CapHeight ' + sp.cap + ' /StemV ' + (k === 'bold' ? 140 : 80) + ' /FontFile2 ' + ff + ' 0 R >>');
      var gids = Object.keys(f.used).map(Number).sort(function (a, b) { return a - b; });
      var inv = {}; Object.keys(sp.map).forEach(function (cp) { inv[sp.map[cp][0]] = sp.map[cp][1]; });
      var W = gids.map(function (g) { return g + ' [' + (inv[g] == null ? 500 : inv[g]) + ']'; }).join(' ');
      var cid = add('<< /Type /Font /Subtype /CIDFontType2 /BaseFont /' + tag + ' /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ' + fd + ' 0 R /DW 600 /W [' + W + '] /CIDToGIDMap /Identity >>');
      var cm = '/CIDInit /ProcSet findresource begin 12 dict begin begincmap /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def /CMapName /Adobe-Identity-UCS def /CMapType 2 def 1 begincodespacerange <0000> <FFFF> endcodespacerange\n';
      for (var i = 0; i < gids.length; i += 100) {
        var part = gids.slice(i, i + 100);
        cm += part.length + ' beginbfchar\n' + part.map(function (g) {
          var u = f.used[g], s = '';
          if (u > 0xFFFF) { u -= 0x10000; s = ('0000' + (0xD800 + (u >> 10)).toString(16)).slice(-4) + ('0000' + (0xDC00 + (u & 1023)).toString(16)).slice(-4); }
          else s = ('0000' + u.toString(16)).slice(-4);
          return '<' + ('0000' + g.toString(16)).slice(-4) + '> <' + s + '>';
        }).join('\n') + '\nendbfchar\n';
      }
      cm += 'endcmap CMapName currentdict /CMap defineresource pop end end';
      var tu = streamObj('', ascii(cm));
      fontRefs[k] = add('<< /Type /Font /Subtype /Type0 /BaseFont /' + tag + ' /Encoding /Identity-H /DescendantFonts [' + cid + ' 0 R] /ToUnicode ' + tu + ' 0 R >>');
    });
    var imRef = 0;
    if (self.logo) {
      var sm = streamObj('/Type /XObject /Subtype /Image /Width ' + self.logo.w + ' /Height ' + self.logo.h + ' /ColorSpace /DeviceGray /BitsPerComponent 8', self.logo.alpha);
      imRef = streamObj('/Type /XObject /Subtype /Image /Width ' + self.logo.w + ' /Height ' + self.logo.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask ' + sm + ' 0 R', self.logo.rgb);
    }
    var pageRefs = [];
    self.pages.forEach(function (pg) {
      var cs = streamObj('', ascii(pg.ops.join('\n')));
      pageRefs.push(add('<< /Type /Page /Parent ' + pagesObj + ' 0 R /MediaBox [0 0 ' + f2(PW) + ' ' + f2(PH) + '] /Resources << /Font << /F1 ' + fontRefs.regular + ' 0 R /F2 ' + fontRefs.bold + ' 0 R >>' + (imRef ? ' /XObject << /Im1 ' + imRef + ' 0 R >>' : '') + ' >> /Contents ' + cs + ' 0 R >>'));
    });
    var info = add('<< /Title <' + utf16hex(meta.title) + '> /Author <' + utf16hex('MONEVA') + '> /Creator <' + utf16hex('MONEVA') + '> /Producer <' + utf16hex('MONEVA') + '> /CreationDate (' + pdfDate(new Date()) + ') >>');
    objs[catalog - 1] = '<< /Type /Catalog /Pages ' + pagesObj + ' 0 R /Lang (' + (meta.lang || 'ru') + ') /ViewerPreferences << /DisplayDocTitle true >> >>';
    objs[pagesObj - 1] = '<< /Type /Pages /Kids [' + pageRefs.map(function (r) { return r + ' 0 R'; }).join(' ') + '] /Count ' + pageRefs.length + ' >>';
    return Promise.all(zip).then(function () {
      var chunks = [ascii('%PDF-1.5\n%\xE2\xE3\xCF\xD3\n')], offsets = [], pos = chunks[0].length;
      objs.forEach(function (o, i) {
        offsets.push(pos);
        var head = ascii((i + 1) + ' 0 obj\n'), body, tail = ascii('\nendobj\n');
        if (typeof o === 'string') body = [ascii(o)];
        else body = [ascii('<< ' + o.dict + ' >>\nstream\n'), o.data, ascii('\nendstream')];
        var parts = [head].concat(body, [tail]);
        parts.forEach(function (p) { chunks.push(p); pos += p.length; });
      });
      var xref = 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offsets.map(function (o) { return ('0000000000' + o).slice(-10) + ' 00000 n \n'; }).join('');
      xref += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root ' + catalog + ' 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + pos + '\n%%EOF\n';
      chunks.push(ascii(xref));
      return new Blob([concat(chunks)], { type: 'application/pdf' });
    });
  };
  function utf16hex(s) { var o = 'FEFF'; for (var i = 0; i < s.length; i++) o += ('0000' + s.charCodeAt(i).toString(16)).slice(-4); return o; }
  function pdfDate(d) { function p(n) { return ('0' + n).slice(-2); } return 'D:' + d.getUTCFullYear() + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCSeconds()) + 'Z'; }

  /* ---------- макет отчёта ---------- */
  var INK = '#101a17', MUTED = '#55655f', LINE = '#dce4e0', ACC = '#0b6152', INC = '#12794b', OUTC = '#c0392b', SOFT = '#f2f6f4';
  var PALETTE = ['#0b6152', '#e07a1f', '#3d6fb5', '#c24132', '#8a4fb8', '#0f8aa8', '#b89a1f', '#d0558a', '#5f6b76', '#6a9c2c'];

  function build(data) {
    var FS = root.MONEVA_PDF_FONTS;
    if (!FS) return Promise.reject(new Error('Нет шрифта для PDF'));
    var fonts = { regular: new Font('regular', FS.regular, 'F1'), bold: new Font('bold', FS.bold, 'F2') };
    var d = new Doc(fonts, data.logo), L = data.labels, y;
    var CW = PW - 2 * MX, BOTTOM = PH - 52;
    function money(n, noCur) { return data.money(n, noCur); }

    /* шапка */
    d.rect(0, 0, PW, 118, ACC);
    d.rect(MX, 30, 46, 46, '#ffffff', null, 0, 11);
    if (data.logo) d.image(MX + 4, 34, 38, 38); else d.text('M', MX + 23, 62, 28, { bold: true, color: ACC, align: 'center' });
    d.text('MONEVA', MX + 60, 52, 22, { bold: true, color: '#ffffff' });
    d.text(L.slogan, MX + 60, 69, 9.5, { color: '#cfe8df' });
    d.text(L.reportTitle, PW - MX, 50, 14, { bold: true, color: '#ffffff', align: 'right' });
    d.text(data.period, PW - MX, 67, 11, { color: '#ffffff', align: 'right' });
    d.text(L.created + ': ' + data.created, PW - MX, 84, 8.5, { color: '#cfe8df', align: 'right' });
    d.text(L.currency + ': ' + data.currencyName, MX, 104, 8.5, { color: '#cfe8df' });
    y = 138;

    /* показатели */
    var cards = [
      [L.income, money(data.income), INC],
      [L.expense, money(data.expense), OUTC],
      [L.result, (data.result < 0 ? '−' : '+') + money(Math.abs(data.result)), data.result < 0 ? OUTC : INC],
      [L.balance, money(data.balance), INK]
    ];
    var cw = (CW - 3 * 8) / 4;
    cards.forEach(function (c, i) {
      var x = MX + i * (cw + 8);
      d.rect(x, y, cw, 58, SOFT, LINE, 0.6, 8);
      d.text(c[0], x + 10, y + 17, 8, { color: MUTED });
      var size = 13.5, txt = c[1];
      while (size > 8 && d.width(txt, size, true) > cw - 20) size -= 0.5;
      d.text(txt, x + 10, y + 40, size, { bold: true, color: c[2] });
    });
    y += 58 + 4;
    d.text(L.balanceNote, MX, y + 9, 7.5, { color: MUTED });
    y += 26;

    function heading(t) {
      d.text(t, MX, y + 11, 12.5, { bold: true, color: INK });
      d.line(MX, y + 18, MX + CW, y + 18, LINE, 0.8);
      y += 30;
    }

    /* расходы по категориям */
    heading(L.byCategory);
    var cats = data.cats, total = data.expense;
    if (!cats.length) { d.text(L.noExpenses, MX, y + 10, 10, { color: MUTED }); y += 30; }
    else {
      var R = 62, cx = MX + R + 4, cy = y + R + 2, a = 0;
      cats.forEach(function (c, i) {
        var frac = total ? c.amount / total : 0, a1 = a + frac * Math.PI * 2;
        if (frac > 0) d.ring(cx, cy, R, R * 0.58, a, a1, PALETTE[i % PALETTE.length]);
        a = a1;
      });
      d.text(L.expense, cx, cy - 2, 8, { color: MUTED, align: 'center' });
      var tsz = 11; while (tsz > 7 && d.width(money(total, true), tsz, true) > R * 1.05) tsz -= 0.5;
      d.text(money(total, true), cx, cy + 11, tsz, { bold: true, align: 'center' });
      // легенда справа от диаграммы
      var lx = MX + 2 * R + 30, ly = y + 6, shown = cats.slice(0, 8), rowH = 17;
      shown.forEach(function (c, i) {
        d.rect(lx, ly + i * rowH - 7, 9, 9, PALETTE[i % PALETTE.length], null, 0, 2);
        var pc = total ? c.amount / total * 100 : 0;
        d.text(d.fit(c.name, 9.5, 150), lx + 15, ly + i * rowH + 1, 9.5, { color: INK });
        d.text(pct(pc), PW - MX - 92, ly + i * rowH + 1, 9.5, { color: MUTED, align: 'right' });
        d.text(money(c.amount), PW - MX, ly + i * rowH + 1, 9.5, { bold: true, align: 'right' });
      });
      if (cats.length > 8) d.text('… ' + L.andMore.replace('{0}', cats.length - 8), lx + 15, ly + 8 * rowH + 1, 8.5, { color: MUTED });
      y += Math.max(2 * R + 14, shown.length * rowH + 10);
      // таблица категорий
      y += 6;
      var cX = [MX + 8, MX + CW - 190, MX + CW - 120, MX + CW - 8];
      function catHead() {
        d.rect(MX, y, CW, 20, ACC, null, 0, 5);
        d.text(L.category, cX[0], y + 13.5, 8.5, { bold: true, color: '#fff' });
        d.text(L.share, cX[2], y + 13.5, 8.5, { bold: true, color: '#fff', align: 'right' });
        d.text(L.amount, cX[3], y + 13.5, 8.5, { bold: true, color: '#fff', align: 'right' });
        y += 20;
      }
      catHead();
      cats.forEach(function (c, i) {
        if (y + 20 > BOTTOM) { d.newPage(); y = 50; catHead(); }
        if (i % 2) d.rect(MX, y, CW, 19, '#f7faf8');
        d.rect(MX + 8, y + 6, 7, 7, PALETTE[i % PALETTE.length], null, 0, 1.5);
        d.text(d.fit(c.name, 9, 230), MX + 22, y + 13, 9, {});
        var pc = total ? c.amount / total * 100 : 0;
        // полоска доли
        d.rect(cX[1] - 40, y + 7, 60, 5, LINE, null, 0, 2.5);
        if (pc > 0) { var bwid = Math.max(3, 60 * pc / 100); d.rect(cX[1] - 40, y + 7, bwid, 5, PALETTE[i % PALETTE.length], null, 0, Math.min(2.5, bwid / 2)); }
        d.text(pct(pc), cX[2], y + 13, 9, { align: 'right', color: MUTED });
        d.text(money(c.amount), cX[3], y + 13, 9, { bold: true, align: 'right' });
        y += 19;
      });
      d.line(MX, y, MX + CW, y, INK, 0.8);
      d.text(L.total, cX[0], y + 14, 9.5, { bold: true });
      d.text('100%', cX[2], y + 14, 9.5, { bold: true, align: 'right' });
      d.text(money(total), cX[3], y + 14, 9.5, { bold: true, align: 'right' });
      y += 30;
    }

    /* динамика расходов */
    var chartH = 150;
    if (y + chartH + 50 > BOTTOM) { d.newPage(); y = 50; }
    heading(data.series.title);
    var vals = data.series.values, labs = data.series.labels, n = vals.length;
    if (!n || vals.every(function (v) { return !v; })) { d.text(L.noExpenses, MX, y + 10, 10, { color: MUTED }); y += 30; }
    else {
      var maxV = Math.max.apply(null, vals), top = niceMax(maxV), gx = MX + 44, gw = CW - 44, gy = y + 6, gh = chartH - 30, i;
      for (i = 0; i <= 4; i++) {
        var yy = gy + gh - gh * i / 4;
        d.line(gx, yy, gx + gw, yy, i ? LINE : '#b9c6c0', i ? 0.5 : 0.8, i ? '2 2' : null);
        d.text(data.compact(top * i / 4), gx - 6, yy + 3, 7.5, { color: MUTED, align: 'right' });
      }
      var bw = gw / n, bar = Math.max(1.5, Math.min(20, bw * 0.62));
      vals.forEach(function (v, k) {
        var hgt = top ? gh * v / top : 0, x = gx + bw * k + (bw - bar) / 2;
        if (v > 0) d.rect(x, gy + gh - hgt, bar, Math.max(hgt, 1), OUTC, null, 0, Math.min(2, bar / 2));
      });
      var step = Math.ceil(n / 12);
      labs.forEach(function (lb, k) { if (lb && k % step === 0) d.text(lb, gx + bw * k + bw / 2, gy + gh + 13, 7.5, { color: MUTED, align: 'center' }); });
      y += chartH + 6;
    }

    /* операции */
    if (y + 120 > BOTTOM) { d.newPage(); y = 50; } else y += 8;
    heading(L.operations + ' (' + data.ops.length + ')');
    var colX = { date: MX + 8, cat: MX + 62, note: MX + 156, wal: MX + CW - 196, amt: MX + CW - 8 };
    function opsHead() {
      d.rect(MX, y, CW, 20, ACC, null, 0, 5);
      d.text(L.date, colX.date, y + 13.5, 8.5, { bold: true, color: '#fff' });
      d.text(L.category, colX.cat, y + 13.5, 8.5, { bold: true, color: '#fff' });
      d.text(L.comment, colX.note, y + 13.5, 8.5, { bold: true, color: '#fff' });
      d.text(L.wallet, colX.wal, y + 13.5, 8.5, { bold: true, color: '#fff' });
      d.text(L.amount, colX.amt, y + 13.5, 8.5, { bold: true, color: '#fff', align: 'right' });
      y += 20;
    }
    function opRow(o, i) {
      var noteLines = d.wrap(o.note || '', 8.5, colX.wal - colX.note - 10, 2);
      var rh = Math.max(19, 8 + noteLines.length * 10.5);
      if (y + rh > BOTTOM) { d.newPage(); y = 50; opsHead(); }
      if (i % 2) d.rect(MX, y, CW, rh, '#f7faf8');
      d.text(o.date, colX.date, y + 13, 8.5, { color: MUTED });
      d.text(d.fit(o.cat, 8.5, colX.note - colX.cat - 8), colX.cat, y + 13, 8.5, {});
      noteLines.forEach(function (ln, k) { d.text(ln, colX.note, y + 13 + k * 10.5, 8.5, { color: o.note ? INK : MUTED }); });
      d.text(d.fit(o.wallet, 8.5, colX.amt - colX.wal - 84), colX.wal, y + 13, 8.5, { color: MUTED });
      d.text((o.sign < 0 ? '−' : '+') + money(o.amount), colX.amt, y + 13, 8.5, { bold: true, align: 'right', color: o.sign < 0 ? OUTC : INC });
      y += rh;
    }
    if (!data.ops.length) { d.text(L.noOps, MX, y + 12, 10, { color: MUTED }); y += 30; }
    else {
      opsHead();
      data.ops.forEach(opRow);
      if (y + 66 > BOTTOM) { d.newPage(); y = 50; }
      d.line(MX, y, MX + CW, y, INK, 0.8); y += 4;
      [[L.totalIncome, '+' + money(data.income), INC], [L.totalExpense, '−' + money(data.expense), OUTC], [L.result, (data.result < 0 ? '−' : '+') + money(Math.abs(data.result)), data.result < 0 ? OUTC : INC]].forEach(function (r, k) {
        d.text(r[0], colX.date, y + 13 + k * 16, 9.5, { bold: true });
        d.text(r[1], colX.amt, y + 13 + k * 16, 9.5, { bold: true, align: 'right', color: r[2] });
      });
      y += 54;
    }
    // переводы и долги
    if (data.other && data.other.length) {
      if (y + 70 > BOTTOM) { d.newPage(); y = 50; }
      y += 8; heading(L.transfers);
      d.text(L.transfersNote, MX, y - 6, 8, { color: MUTED }); y += 10;
      opsHead();
      data.other.forEach(opRow);
      y += 10;
    }

    /* нижний колонтитул и нумерация */
    var total_pages = d.pages.length;
    d.pages.forEach(function (pg, i) {
      d.cur = pg;
      d.line(MX, PH - 40, PW - MX, PH - 40, LINE, 0.6);
      d.text('MONEVA · ' + data.period, MX, PH - 26, 8, { color: MUTED });
      d.text(L.page + ' ' + (i + 1) + ' ' + L.of + ' ' + total_pages, PW - MX, PH - 26, 8, { color: MUTED, align: 'right' });
    });
    return d.finish({ title: 'MONEVA — ' + data.period, lang: data.lang });
  }
  function pct(p) { return (Math.round(p * 10) / 10).toString().replace('.', ',') + '%'; }
  function niceMax(v) {
    if (v <= 0) return 1;
    var e = Math.pow(10, Math.floor(Math.log10(v))), m = v / e, nm = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
    return nm * e;
  }

  root.MonevaPDF = { build: build };
})(typeof window !== 'undefined' ? window : globalThis);
