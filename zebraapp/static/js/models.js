/* Yazici modelleri: cozunurluk ve yaklasik en genis baski alani (mm). */
window.MODELS = [
  { id: "zd421", name: "ZD421 (d / t / c)", dpis: [203, 300], width: 104 },
  { id: "zd621", name: "ZD621 (d / t)", dpis: [203, 300], width: 104 },
  { id: "zd411", name: "ZD411 (d / t)", dpis: [203, 300], width: 56 },
  { id: "zd420", name: "ZD420", dpis: [203, 300], width: 104 },
  { id: "zd410", name: "ZD410", dpis: [203, 300], width: 56 },
  { id: "zd220", name: "ZD220 / ZD230", dpis: [203], width: 104 },
  { id: "zd888", name: "ZD888", dpis: [203], width: 104 },
  { id: "gk420", name: "GK420d / GK420t", dpis: [203], width: 104 },
  { id: "gx420", name: "GX420d / GX420t", dpis: [203], width: 104 },
  { id: "gx430", name: "GX430t", dpis: [300], width: 104 },
  { id: "zt230", name: "ZT230", dpis: [203, 300], width: 104 },
  { id: "zt411", name: "ZT411", dpis: [203, 300, 600], width: 104 },
  { id: "zt421", name: "ZT421", dpis: [203, 300], width: 168 },
  { id: "zt610", name: "ZT610", dpis: [203, 300, 600], width: 104 },
  { id: "zt620", name: "ZT620", dpis: [203, 300], width: 168 },
  { id: "zq630", name: "ZQ630", dpis: [203], width: 104 },
  { id: "zq620", name: "ZQ620", dpis: [203], width: 72 },
  { id: "zq520", name: "ZQ520", dpis: [203], width: 72 },
  { id: "zq320", name: "ZQ320", dpis: [203], width: 48 },
  { id: "other", name: "Diğer ZPL yazıcı", dpis: [203, 300, 600], width: 0 }
];
window.modelById = function (id) {
  for (var i = 0; i < window.MODELS.length; i++) if (window.MODELS[i].id === id) return window.MODELS[i];
  return window.MODELS[window.MODELS.length - 1];
};
