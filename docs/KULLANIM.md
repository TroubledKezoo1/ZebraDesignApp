# ZebraApp kullanım kılavuzu

[English user guide](USER_GUIDE.md) · [README'ye dön](../README.tr.md)

Bu kılavuz ZebraApp'i ilk açılıştan basılmış etikete kadar anlatır.

![Editör](screenshot-tr.png)

## 1. Uygulamayı başlat

README'deki gibi kur, sonra `zebraapp` komutunu çalıştır (ya da sistemin için olan başlatıcıya çift tıkla). Editör kendi penceresinde açılır, pencereyi kapatınca birkaç saniye sonra kendiliğinden kapanır.

Uygulama her seferinde **Adsız etiket** adlı boş bir etiketle açılır. Adı değiştirmek için pencerenin üstündeki kutuya yaz.

## 2. Yazıcını ekle

1. Sağ üstteki **Yazıcılar…** düğmesine bas (ya da yazıcı listesinden **+ Yazıcı ekle…** seç) ve yeni bir yazıcı ekle.
2. **Modeli** seç (örneğin *ZD421*) ve **çözünürlüğü** seç (203 ya da 300 dpi; yazıcının kutusunda ve ayar etiketinde yazar).
3. **Bağlantıyı** seç:
   - **Bluetooth LE:** **Ara**'ya bas, listeden yazıcını seç. Yazıcı aynı anda tek cihaza bağlanır, bu yüzden önce telefonunun Bluetooth'unu kapat.
   - **Ağ:** yazıcının IP adresini yaz (port 9100).
   - **Sistem yazıcısı / USB:** **Listele**'ye bas, raw kuyruğunu seç.
   - **USB aygıt dosyası**, **Seri port**, **Harici komut:** özel kurulumlar içindir, README'deki tabloya bak.
4. **Test etiketi bas**'a bas. Küçük bir etiket çıkarsa hazırsın. **Durumu oku** kâğıt bitti, kapak açık, duraklatıldı gibi durumları gösterir.

Birden çok yazıcı ekleyebilir, sağ üstteki listeden aralarında geçebilirsin.

## 3. Ekranı tanı

| Bölge | Ne yapar |
|---|---|
| Üst çubuk | Dosya menüsü, etiket adı, Kaydet, Geri al / Yinele, yakınlaştırma, ızgara ve yakalama, yazıcı seçimi, **Yazdır** |
| Sol üst | Araçlar: Seç, Metin, QR, Barkod, Çizgi, Kutu, Elips, Görsel |
| Sol alt | **Katmanlar:** göster / gizle, kilitle, yeniden adlandır, sürükleyerek sırala |
| Orta | Cetvelli (mm) etiket. Yakınlaştırınca ızgara yazıcının noktalarını gösterir |
| Sağ | **Özellikler** (seçili öğe), **Etiket** (boyut ve yazıcı ayarları), **Yazdır** sekmeleri |

## 4. Etiket boyutunu ayarla

**Etiket** sekmesini aç, hazır bir boyut seç (80 × 40, 100 × 150 …) ya da genişlik ve yüksekliği milimetre olarak yaz. Çözünürlüğü yazıcıya uydur.

Bu etiketin yazıcı ayarları da aynı sekmede:

- **Ortam türü:** kalıplı etiketler için *Boşluklu*, aralıksız rulolar için *Sürekli*, arkasında işaret olan ruloları için *Siyah işaretli*.
- **Koyuluk** (0–30) ve **Hız:** boş bırakırsan yazıcının kendi ayarı kullanılır.
- **Yatay / Dikey kaydırma:** tasarım kenara çok yakınsa bütün tasarımı taşır.
- **Baskıyı 180° çevir:** ters çıkan etiketler için.

Yeni rulo taktıktan sonra **Yazdır** sekmesinden bir kez **Kalibre et**'e bas; yazıcı etiket boyunu öğrenir.

## 5. Etiketi tasarla

Soldan bir araç seç, etikete tıkla (çizgi, kutu ve elipste sürükle). Ayrıntıları **Özellikler** sekmesinden ayarla.

- **Metin:** boyut (mm), kalın, harf genişliği, satır aralığı, sola / ortaya / sağa yaslama, sabit kutu genişliği ve otomatik satır kaydırma, 90° adımlarla döndürme, **ters baskı** (siyah üstüne beyaz; arkasına siyah kutu çizer).
- **QR kod:** içerik ve modül boyutu. Önizleme birebir aynıdır.
- **Barkod:** Code 128, Code 39 ya da EAN-13; yükseklik, çubuk kalınlığı, altında okunabilir yazı açık ya da kapalı.
- **Çizgi, Kutu, Elips:** kalınlık, dolu, yuvarlak köşe.
- **Görsel:** logo ya da resim seç. Yazıcı için siyah beyaza çevrilir. **Eşik** kesim noktasını, **noktalama** gri tonları, **ters çevir** renkleri değiştirir.

İşe yarar kısayollar:

- Sürükleyerek taşı, sekiz tutamaçla boyutlandır. **Alt** basılıyken yapışmadan taşırsın.
- **Shift** ile tıkla ya da boş alanda sürükle: birden çok öğe seçilir. Hizalama ve eşit dağıtma düğmeleri o zaman öğeler arasında çalışır; tek öğe etikete göre hizalanır.
- Ok tuşları az, **Shift** ile ok tuşları 10 kat taşır.
- **Ctrl+Z / Ctrl+Y** geri al ve yinele, **Ctrl+C / V / D** kopyala, yapıştır, çoğalt, **Del** siler.
- **Ctrl** + tekerlek yakınlaştırır, **0** etiketi pencereye sığdırır, **Boşluk** + sürükle kaydırır.

## 6. Kaydet ve aç

Etiketler `.zebra` uzantılı sıradan dosyalardır (içi JSON). Nerede duracağına sen karar verirsin.

| İşlem | Kısayol |
|---|---|
| **Kaydet:** ilk seferde yer ve ad sorar, sonra aynı dosyaya yazar | Ctrl+S |
| **Farklı kaydet…:** her seferinde sorar | Ctrl+Shift+S |
| **Aç…:** dosya seç ya da son kullanılanlardan seç | Ctrl+O |
| **Yeni etiket** (Dosya menüsü) | |

**Aç** penceresi örnek etiketleri ve uygulamanın eski sürümlerinde kaydedilenleri de listeler. Birini açınca kopyası açılır; Ctrl+S onu dosyaya çevirir.

Kaydedilmemiş değişiklik varken pencereyi kapatırsan uygulama önce sorar.

## 7. Yazdır

**Yazdır** sekmesine bak, sonra sağ üstteki **Yazdır**'a bas.

- **Her etiketten adet:** her etiketten kaç tane aynı kopya basılacağı.
- **Farklı etiket sayısı:** kaç farklı etiket basılacağı; sayaç ve veri listesiyle birlikte kullanılır.

### Sayaç ve tarih

Bunları herhangi bir metin, QR ya da barkod alanına yaz:

- `{SAYAC}` sayaçtır. *Sayaç* bölümünden başlangıç, artış ve basamak sayısını ayarlarsın. 3 basamak ve başlangıç 1 ile 001, 002, 003… çıkar.
- `{TARIH}` bugünün tarihi (gg.aa.yyyy), `{SAAT}` saattir.

### Listeden bas (CSV)

1. **Yazdır** sekmesinde *Veri listesi* kutusuna bir tablo yapıştır ya da **Dosyadan yükle**'ye bas. İlk satır sütun adlarıdır; `;`, `,` ya da sekme ile ayrılır.
2. Herhangi bir alana `{sütun_adı}` yaz. Sütun adları kutunun altında etiket olarak görünür.
3. Her satır için bir etiket basılır. Her satırı tuvalde görmek için *Önizlemede gösterilen kayıt* alanını kullan.

Örnek:

```
ad;il;telefon
Örnek Makina;İstanbul;0212 000 00 00
```

Bir metin alanına `{ad} - {il}` yazarsan "Örnek Makina - İstanbul" basılır.

### Basmadan önce kontrol et

- **Gerçek önizleme (Labelary)** ZPL'i labelary.com'a gönderir ve bir Zebra'nın nasıl basacağını gösterir (internet gerekir).
- **ZPL kodunu göster** yazıcıya gidecek kodun kendisini açar. Düzenleyip elle gönderebilir ya da `.zpl` dosyası olarak kaydedebilirsin.

## 8. Sorun giderme

**Etiketin yalnızca bir kısmı basılıyor ya da kesiliyor.** Etiket boyutunun ve çözünürlüğün (Etiket sekmesi) gerçek etiketlerle ve yazıcıyla aynı olduğunu kontrol et. Doğru ortam türünü seç, sonra **Kalibre et**'e bas.

**Çok açık ya da çok koyu basıyor.** Etiket sekmesinde *Koyuluk* ayarla (birkaç adım artırarak dene).

**Bluetooth'a bağlanmıyor.** Telefonunun Bluetooth'unu kapat, yazıcıyı kullanan başka uygulamaları kapat. Yeniden **Ara**'ya bas ve yazıcıyı seç. Linux'ta `bleak` kurulu olmalı (`pip install ".[ble]"`) ve Bluetooth servisi çalışmalı.

**Baskılar arasında boş etiket çıkıyor.** Ortam türü büyük olasılıkla yanlış ya da yazıcının kalibre edilmesi gerekiyor.

**Yazdır'a basınca hiçbir şey olmuyor.** Alttaki çubuktaki mesaja bak. Yazıcı eklenmedi diyorsa **Yazıcılar…** bölümünden ekle.

**Pencere minicik ya da yanlış yerde.** Chrome uygulama pencerelerinin boyutunu adrese göre hatırlar. Bir kez büyüt ya da uygulamayı başka bir portta başlat: `zebraapp --port 8766`.

**Metin yazıcıda farklı görünüyor.** Önizleme yazıcıya giden yazı tipini kullanır; fark çoğunlukla yanlış çözünürlük ayarından gelir.

## 9. Her şey nerede duruyor

- Etiketlerin: kaydettiğin yer.
- Yazıcı listesi ve dil: README'de yazan klasör (Linux'ta `~/.config/zebraapp/`).

Bilgisayarından dışarı yalnızca **Gerçek önizleme (Labelary)**'ye bastığında veri gider.
