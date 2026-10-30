"""Turkish translations for server-side messages (English is the source)."""

TR = {
    'PDF files must be non-empty and no larger than 20 MB.': 'PDF dosyası boş olamaz ve en fazla 20 MB olabilir.',
    'PDF import needs pypdfium2 and Pillow: pip install "zebraapp[pdf]"': 'PDF açmak için pypdfium2 ve Pillow gerekli: pip install "zebraapp[pdf]"',
    'The PDF could not be opened. Check that it is valid and not password-protected.': 'PDF açılamadı. Dosyanın geçerli ve parolasız olduğundan emin ol.',
    'A PDF must contain between 1 and 500 pages.': 'PDF 1 ile 500 arasında sayfa içermeli.',
    'PDF page dimensions must be between 1 and 2000 mm.': 'PDF sayfa boyutları 1 ile 2000 mm arasında olmalı.',
    'Choose a resolution of 203, 300 or 600 dpi.': '203, 300 veya 600 dpi çözünürlük seç.',
    'Choose a valid PDF page number.': 'Geçerli bir PDF sayfa numarası seç.',
    'This PDF page is too large at this resolution. Choose a lower dpi (maximum 4 million pixels).': 'Bu PDF sayfası seçilen çözünürlükte çok büyük. Daha düşük dpi seç (en fazla 4 milyon piksel).',

    "BLE needs the 'bleak' package:  pip install bleak": "Bluetooth LE için 'bleak' paketi gerekli:  pip install bleak",
    "Printer not found over Bluetooth. It must be on, in range and not connected to another device (e.g. a phone).":
        "Yazıcı Bluetooth ile bulunamadı. Açık, yakında ve başka bir cihaza (ör. telefona) bağlı olmamalı.",
    "No writable Bluetooth characteristic found on this device.": "Bu cihazda yazılabilir bir Bluetooth özelliği bulunamadı.",
    "This printer does not report status over Bluetooth.": "Bu yazıcı Bluetooth üzerinden durum bildirmiyor.",
    "Enter the printer's IP address.": "Yazıcının IP adresini gir.",
    "Could not reach %s:%d (%s)": "%s:%d adresine ulaşılamadı (%s)",
    "Choose a system printer (queue).": "Bir sistem yazıcısı (kuyruk) seç.",
    "Windows printing needs pywin32:  pip install pywin32": "Windows'ta yazdırmak için pywin32 gerekli:  pip install pywin32",
    "The 'lp' command (CUPS) was not found.": "'lp' komutu (CUPS) bulunamadı.",
    "lp failed: %s": "lp hata verdi: %s",
    "The 'lpstat' command (CUPS) was not found.": "'lpstat' komutu (CUPS) bulunamadı.",
    "Enter the device path, e.g. /dev/usb/lp0": "Aygıt yolunu gir, ör. /dev/usb/lp0",
    "No permission for %s. Add yourself to the 'lp' group:  sudo usermod -aG lp $USER  (then log out and in)":
        "%s için izin yok. Kendini 'lp' grubuna ekle:  sudo usermod -aG lp $USER  (sonra oturumu kapatıp aç)",
    "Could not open %s (%s)": "%s açılamadı (%s)",
    "Serial ports need pyserial:  pip install pyserial": "Seri port için pyserial gerekli:  pip install pyserial",
    "Choose a serial port (e.g. /dev/rfcomm0, /dev/ttyUSB0 or COM3).": "Bir seri port seç (ör. /dev/rfcomm0, /dev/ttyUSB0 ya da COM3).",
    "Serial port error: %s": "Seri port hatası: %s",
    "Enter a command that reads ZPL from standard input, e.g. zebra-print": "ZPL'yi standart girişten okuyan bir komut gir, ör. zebra-print",
    "Command not found: %s": "Komut bulunamadı: %s",
    "%s exited with code %d: %s": "%s %d koduyla çıktı: %s",
    "Unknown connection type: %s": "Bilinmeyen bağlantı türü: %s",
    "Status can only be read over network, serial or Bluetooth LE.": "Durum yalnızca ağ, seri port ya da Bluetooth LE üzerinden okunabilir.",
    "Search is not available for this connection type.": "Bu bağlantı türünde arama yapılamıyor.",
    "The printer did not answer the status request.": "Yazıcı durum isteğine cevap vermedi.",
    # server
    "No printer selected. Add one under Printers.": "Yazıcı seçili değil. Yazıcılar bölümünden bir yazıcı ekle.",
    "Nothing to send.": "Gönderilecek veri yok.",
    "Sent %d bytes to %s.": "%s yazıcısına %d bayt gönderildi.",
    "Connected: %s": "Bağlandı: %s",
    "Disconnected.": "Bağlantı kesildi.",
    "Only Bluetooth LE printers keep a connection open.": "Yalnızca Bluetooth LE yazıcılar açık bağlantı tutar.",
    "Printer is ready.": "Yazıcı hazır.",
    "Labelary error %d: %s": "Labelary hatası %d: %s",
    "Could not reach Labelary (is the internet on?): %s": "Labelary'ye ulaşılamadı (internet var mı?): %s",
    "Unexpected error: %s": "Beklenmeyen hata: %s",
}

# Messages whose arguments appear in a different order in Turkish
REORDER = {"Sent %d bytes to %s.": (1, 0)}


def localize(template, params, lang):
    if lang != "tr":
        return template % params if params else template
    t = TR.get(template, template)
    if params and template in REORDER:
        params = tuple(params[i] for i in REORDER[template])
    try:
        return t % params if params else t
    except (TypeError, ValueError):
        return template % params if params else template
