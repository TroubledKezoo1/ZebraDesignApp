/* Barkod kodlayicilari (onizleme icin). Cikti: [{w: birim, bar: bool}, ...] */
(function (G) {
  "use strict";

  var C128 = [
    "212222","222122","222221","121223","121322","131222","122213","122312","132212","221213",
    "221312","231212","112232","122132","122231","113222","123122","123221","223211","221132",
    "221231","213212","223112","312131","311222","321122","321221","312212","322112","322211",
    "212123","212321","232121","111323","131123","131321","112313","132113","132311","211313",
    "231113","231311","112133","112331","132131","113123","113321","133121","313121","211331",
    "231131","213113","213311","213131","311123","311321","331121","312113","312311","332111",
    "314111","221411","431111","111224","111422","121124","121421","141122","141221","112214",
    "112412","122114","122411","142112","142211","241211","221114","413111","241112","134111",
    "111242","121142","121241","114212","124112","124211","411212","421112","421211","212141",
    "214121","412121","111143","111341","131141","114113","114311","411113","411311","113141",
    "114131","311141","411131","211412","211214","211232","2331112"
  ];

  function widthsToBars(str, out) {
    for (var i = 0; i < str.length; i++) out.push({ w: +str[i], bar: i % 2 === 0 });
  }

  function digitRun(s, i) {
    var n = 0;
    while (i + n < s.length && s.charCodeAt(i + n) >= 48 && s.charCodeAt(i + n) <= 57) n++;
    return n;
  }

  /* Code 128, otomatik B/C secimi (ZPL ^BC ... ,A moduna yakin) */
  function code128(data) {
    var s = "";
    for (var k = 0; k < data.length; k++) {
      var c = data.charCodeAt(k);
      if (c >= 32 && c <= 126) s += data[k];
    }
    var vals = [], set, i = 0;
    var run0 = digitRun(s, 0);
    if (run0 >= 4 && (run0 === s.length || run0 >= 4)) { set = "C"; vals.push(105); }
    else { set = "B"; vals.push(104); }
    while (i < s.length) {
      if (set === "C") {
        var r = digitRun(s, i);
        if (r >= 2) { vals.push(+(s[i] + s[i + 1])); i += 2; continue; }
        vals.push(100); set = "B"; continue;
      }
      var run = digitRun(s, i);
      var atEnd = i + run === s.length;
      if (run >= 6 || (run >= 4 && atEnd)) {
        if (run % 2 === 1) { vals.push(s.charCodeAt(i) - 32); i++; }
        vals.push(99); set = "C"; continue;
      }
      vals.push(s.charCodeAt(i) - 32); i++;
    }
    var sum = vals[0];
    for (var j = 1; j < vals.length; j++) sum += vals[j] * j;
    vals.push(sum % 103);
    vals.push(106);
    var out = [];
    vals.forEach(function (v) { widthsToBars(C128[v], out); });
    return { bars: out, text: s };
  }

  var C39 = {
    "0":"000110100","1":"100100001","2":"001100001","3":"101100000","4":"000110001",
    "5":"100110000","6":"001110000","7":"000100101","8":"100100100","9":"001100100",
    "A":"100001001","B":"001001001","C":"101001000","D":"000011001","E":"100011000",
    "F":"001011000","G":"000001101","H":"100001100","I":"001001100","J":"000011100",
    "K":"100000011","L":"001000011","M":"101000010","N":"000010011","O":"100010010",
    "P":"001010010","Q":"000000111","R":"100000110","S":"001000110","T":"000010110",
    "U":"110000001","V":"011000001","W":"111000000","X":"010010001","Y":"110010000",
    "Z":"011010000","-":"010000101",".":"110000100"," ":"011000100","*":"010010100",
    "$":"010101000","/":"010100010","+":"010001010","%":"000101010"
  };

  function code39(data, ratio) {
    ratio = ratio || 3;
    var s = String(data).toUpperCase().split("").filter(function (c) { return C39[c] && c !== "*"; }).join("");
    var full = "*" + s + "*", out = [];
    for (var i = 0; i < full.length; i++) {
      var p = C39[full[i]];
      for (var k = 0; k < 9; k++) out.push({ w: p[k] === "1" ? ratio : 1, bar: k % 2 === 0 });
      if (i < full.length - 1) out.push({ w: 1, bar: false });
    }
    return { bars: out, text: "*" + s + "*" };
  }

  var EAN_L = ["0001101","0011001","0010011","0111101","0100011","0110001","0101111","0111011","0110111","0001011"];
  var EAN_PAR = ["LLLLLL","LLGLGG","LLGGLG","LLGGGL","LGLLGG","LGGLLG","LGGGLL","LGLGLG","LGLGGL","LGGLGL"];
  function inv(p) { return p.replace(/./g, function (c) { return c === "1" ? "0" : "1"; }); }

  function ean13(data) {
    var d = String(data).replace(/\D/g, "").slice(0, 12);
    while (d.length < 12) d += "0";
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += (+d[i]) * (i % 2 ? 3 : 1);
    var chk = (10 - (sum % 10)) % 10;
    d += chk;
    var bits = "101", par = EAN_PAR[+d[0]];
    for (var j = 1; j <= 6; j++) {
      var L = EAN_L[+d[j]];
      bits += par[j - 1] === "L" ? L : inv(L).split("").reverse().join("");
    }
    bits += "01010";
    for (var m = 7; m <= 12; m++) bits += inv(EAN_L[+d[m]]);
    bits += "101";
    var out = [], cur = bits[0], n = 0;
    for (var b = 0; b < bits.length; b++) {
      if (bits[b] === cur) n++;
      else { out.push({ w: n, bar: cur === "1" }); cur = bits[b]; n = 1; }
    }
    out.push({ w: n, bar: cur === "1" });
    return { bars: out, text: d };
  }

  G.Barcodes = {
    encode: function (kind, data, ratio) {
      if (kind === "code39") return code39(data, ratio);
      if (kind === "ean13") return ean13(data);
      return code128(String(data));
    },
    _C128: C128
  };
})(window);
