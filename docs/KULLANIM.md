# ZebraApp kullanım kılavuzu

[English user guide](USER_GUIDE.md) · [README'ye dön](../README.tr.md)

ZebraApp bir kelime işlemci gibi çalışır: üstte şerit menü, yeni, aç, kaydet ve yazdır için **Dosya** ekranı, doğrudan etiketin üstüne yazılan metin. Bu kılavuz ilk açılıştan basılmış etikete kadar anlatır.

![Editör](screenshot-tr.png)

## 1. Uygulamayı başlat

README'deki gibi kur, sonra `zebraapp` komutunu çalıştır (ya da sistemin için olan başlatıcıya çift tıkla). Editör kendi penceresinde açılır, pencereyi kapatınca birkaç saniye sonra kendiliğinden kapanır.

Uygulama **Dosya** ekranında açılır:

- **Yeni:** boş 80 × 40 mm etiket, şablonlardan biri (alıcı etiketi, QR ve barkodlu ürün etiketi, 100 × 150 kargo etiketi) ya da hazır ve özel boyutlar için **Diğer boyutlar…**
- **Son kullanılanlar:** son kaydettiğin ya da açtığın etiketler. Tıklayınca açılır.

Editöre geçmek için **Esc**'ye ya da sol üstteki geri okuna bas.

![Başlangıç ekranı](start-tr.png)

## 2. Ekranı tanı

| Bölge | Ne yapar |
|---|---|
| Başlık çubuğu | Hızlı erişim (Kaydet, Geri al, Yinele, Hızlı yazdır), etiket adı (tıklayıp değiştir), yazıcı seçimi, **Yazıcılar…** ve **Yazdır** |
| Şerit | **Dosya**, **Giriş**, **Ekle**, **Düzen**, **Veri**, **Görünüm** sekmeleri. Sağdaki ok şeridi daraltır; bir sekmeye çift tıklamak da aynısını yapar |
| Katmanlar (sol) | Göster / gizle, kilitle, yeniden adlandır (çift tık), sürükleyerek sırala |
| Etiket (orta) | Milimetre cetvelli etiket. Yakınlaştırınca ızgara yazıcının noktalarını gösterir |
| Özellikler (sağ) | Seçili öğenin bütün ayarları |
| Durum çubuğu | Etiket boyutu, öğe sayısı, seçim, imleç konumu, mesajlar ve yakınlaştırma kaydırıcısı |

**Katmanlar** ve **Özellikler** panelleri **Görünüm** sekmesinden gizlenebilir.

## 3. Yazıcını ekle

1. Başlık çubuğundaki **Yazıcılar…** düğmesine bas (ya da yazıcı listesinden **+ Yazıcı ekle…** seç) ve yeni bir yazıcı ekle.
2. **Modeli** (örneğin *ZD421*) ve **çözünürlüğü** seç (203 ya da 300 dpi; yazıcının kutusunda ve ayar etiketinde yazar).
3. **Bağlantıyı** seç:
   - **Bluetooth LE:** **Ara**'ya bas ve yazıcını seç. Yazıcı aynı anda tek cihaza bağlanır, önce telefonun Bluetooth'unu kapat.
   - **Ağ:** yazıcının IP adresi, port 9100.
   - **Sistem yazıcısı / USB:** **Listele**'ye bas ve raw kuyruğunu seç (Windows'ta kurulu Zebra sürücüsü).
   - **USB aygıt dosyası**, **Seri port**, **Harici komut:** özel kurulumlar için, README'ye bak.
4. **Test etiketi bas**'a bas. **Durumu oku** kâğıt bitti, kapak açık, duraklatıldı gibi durumları gösterir.

Birden çok yazıcı ekleyip başlık çubuğundan aralarında geçebilirsin.

## 4. Etiket boyutunu ayarla (Düzen sekmesi)

- **Boyut:** hazır bir boyut (80 × 40, 100 × 150 …) ya da milimetre olarak genişlik **G** ve yükseklik **Y**, yanında çözünürlük.
- **Ortam:** kalıplı etiketler için *Boşluklu*, aralıksız rulolar için *Sürekli*, arkasında işaret olan rulolar için *Siyah işaretli*.
- **Koyuluk** (0–30) ve **Hız:** boş bırakırsan yazıcının kendi ayarı kullanılır.
- **Kaydırma:** tasarım kenara çok yakınsa bütün tasarımı taşır. Ters çıkan etiketler için **180° çevir**.

Yeni rulo taktıktan sonra yazdırma ekranından bir kez **Kalibre et**'e bas; yazıcı etiket boyunu öğrenir.

## 5. Öğe ekle (Ekle sekmesi)

**Metin**, **QR kod**, **Barkod**, **Çizgi**, **Kutu**, **Elips** ya da **Görsel** seç, sonra etikete tıkla (çizgi, kutu ve elipste sürükle).

- Yeni metin kutusu hemen yazmaya hazır gelir.
- **Alan** grubu `{SAYAC}` (sayaç), `{TARIH}` (tarih) ya da `{SAAT}` (saat) değişkenini yazdığın yere, ya da seçili QR koda veya barkoda ekler.
- Görsel yazıcı için siyah beyaza çevrilir; **eşik**, **noktalama** ve **ters çevir** ayarları Özellikler'de.

## 6. Yaz ve biçimlendir (Giriş sekmesi)

Metne **çift tıkla** (ya da seçip **F2** veya **Enter**'a bas) ve doğrudan etiketin üstüne yaz. Bitirmek için **Esc**'ye bas ya da dışarı tıkla. Boş bırakılan metin kutusu silinir.

![Etiketin üstüne yazma](edit-tr.png)

**Yazı** ve **Paragraf** grupları seçili metne uygulanır, yazarken de çalışır:

- Milimetre olarak yazı yüksekliği, **A+** / **A−** (Ctrl+Shift+> / <), **K** kalın (Ctrl+B), ters baskı (siyah üstüne beyaz), harf genişliği.
- Sola, ortaya, sağa yaslama; uzun satırı alta kaydırma; satır aralığı; metin kutusu genişliği (0 = otomatik).

Biçim tek tek kelimelere değil, metin kutusunun tamamına uygulanır, çünkü yazıcı her kutuyu tek yazı tipiyle basar.

**Pano** grubunda Yapıştır, Kes, Kopyala ve Çoğalt var. **Düzenleme** grubunda Seç, Tümünü seç, Sil ve Metni düzenle var.

## 7. Yerleştir (Düzen sekmesi)

Öğeleri seç, sonra **Yerleştir** grubunu kullan:

- Sola, ortaya, sağa, üste, dikey ortaya, alta hizala. Tek öğe etikete göre, birden fazla öğe birbirine göre hizalanır.
- Eşit dağıt (3 ya da daha fazla öğe).
- Öne getir, arkaya gönder, 90° döndür, kilitle, gizle (gizli öğe basılmaz).

Fareyle: sürükleyerek taşı, sekiz tutamaçla boyutlandır, **Shift** ile tıkla ya da boş alanda sürükleyerek birden çok öğe seç, sürüklerken **Alt** basılıysa yapışma kapanır. Ok tuşları az, **Shift** ile 10 kat taşır.

## 8. Numaralı etiketler ve listeler (Veri sekmesi)

**Sayaç:** herhangi bir metin, QR ya da barkoda `{SAYAC}` yaz. **Başlangıç**, **Artış** ve **Basamak**'ı ayarla (1'den başlayıp 3 basamak: 001, 002 …). Kaç tane basılacağını yazdırma ekranındaki *Farklı etiket sayısı* belirler.

**Liste (CSV):** CSV dosyası seçmek için **Liste yükle**'ye, yapıştırmak için **Listeyi düzenle…**'ye bas. İlk satır sütun adlarıdır; `;`, `,` ya da sekme ile ayrılır. Sütunlar **Alan ekle** altında çıkar; birine tıklayınca `{sütun}` seçili metne eklenir. Her satır için bir etiket basılır.

```
ad;il;telefon
Örnek Makina;İstanbul;0212 000 00 00
```

**Önizleme** altındaki oklarla her kaydı etiketin üstünde görebilirsin.

## 9. Yazdır

**Ctrl+P** (ya da Giriş sekmesindeki **Yazdır…**, ya da **Dosya → Yazdır**) yazdırma ekranını açar:

- Üstte **Yazdır** ve **Her etiketten adet**, altında yazıcı ve uyarıları, **Farklı etiket sayısı** ve toplam kaç etiket çıkacağının özeti.
- Sağda, oklarla kayıtlar arasında gezilen önizleme.
- **Yazıcı araçları:** Kalibre et, Boş etiket ilerlet, Ayar etiketi bas ve ZPL'i labelary.com'a gönderip bir Zebra'nın nasıl basacağını gösteren **Gerçek önizleme (Labelary)** (internet gerekir).

Başlık çubuğundaki yeşil **Yazdır** ve hızlı erişimdeki **Hızlı yazdır**, yazdırma ekranını açmadan doğrudan basar.

![Yazdırma ekranı](print-tr.png)

## 10. Kaydet, aç, dışa aktar (Dosya ekranı)

Etiketler `.zebra` uzantılı sıradan dosyalardır (içi JSON). Nerede duracaklarına sen karar verirsin.

| İşlem | Kısayol |
|---|---|
| **Kaydet:** ilk seferde yer ve ad sorar, sonra aynı dosyaya yazar | Ctrl+S |
| **Farklı kaydet:** her seferinde sorar | Ctrl+Shift+S, F12 |
| **Aç:** dosya seç ya da son kullanılanlardan seç | Ctrl+O |
| **Yeni** | Ctrl+N (Chrome bu kısayolu kendine ayırabilir; Dosya → Yeni'yi kullan) |

**Dosya → Dışa aktar** ZPL'i `.zpl` dosyası olarak kaydeder ya da kodu gösterir; kopyalayabilir, düzenleyip elle gönderebilirsin.

**Dosya → Seçenekler**'den dil değişir. Kaydedilmemiş değişiklik varken kapatmadan ya da başka etiket açmadan önce uygulama sorar.

## 11. Sorun giderme

**Etiketin yalnızca bir kısmı basılıyor ya da kesiliyor.** Düzen sekmesindeki boyutun ve çözünürlüğün gerçek etiketlerle ve yazıcıyla aynı olduğunu kontrol et. Doğru ortam türünü seç, sonra **Kalibre et**'e bas.

**Çok açık ya da çok koyu basıyor.** Düzen sekmesinde *Koyuluk*'u birkaç adım artırarak ya da azaltarak dene.

**Bluetooth'a bağlanmıyor.** Telefonunun Bluetooth'unu kapat, yazıcıyı kullanan başka uygulamaları kapat, yeniden ara. Linux'ta `bleak` kurulu olmalı (`pip install ".[ble]"`) ve Bluetooth servisi çalışmalı.

**Baskılar arasında boş etiket çıkıyor.** Ortam türü büyük olasılıkla yanlış ya da yazıcının kalibre edilmesi gerekiyor.

**Yazdır'a basınca hiçbir şey olmuyor.** Durum çubuğundaki (ya da yazdırma ekranının üstündeki) mesaja bak. Yazıcı eklenmediyse **Yazıcılar…**'dan ekle.

**Pencere minicik ya da yanlış yerde.** Chrome uygulama pencerelerinin boyutunu adrese göre hatırlar. Bir kez büyüt ya da başka bir portta başlat: `zebraapp --port 8766`.

## 12. Her şey nerede duruyor

- Etiketlerin: kaydettiğin yer.
- Yazıcı listesi ve dil: README'de yazan klasör (Linux'ta `~/.config/zebraapp/`).

Bilgisayarından dışarı yalnızca **Gerçek önizleme (Labelary)**'ye bastığında veri gider.
