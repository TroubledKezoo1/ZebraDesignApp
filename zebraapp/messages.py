"""Translations for server-side messages (English is the source)."""

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

# Brazilian Portuguese. The front-end sends the language as "pt" (see i18n.js),
# but a settings file may also carry "pt-BR" / "pt_BR"; localize() normalizes.
PT = {
    'PDF files must be non-empty and no larger than 20 MB.':
        'Arquivos PDF não podem estar vazios e devem ter no máximo 20 MB.',
    'PDF import needs pypdfium2 and Pillow: pip install "zebraapp[pdf]"':
        'A importação de PDF requer pypdfium2 e Pillow: pip install "zebraapp[pdf]"',
    'The PDF could not be opened. Check that it is valid and not password-protected.':
        'Não foi possível abrir o PDF. Verifique se é válido e não está protegido por senha.',
    'A PDF must contain between 1 and 500 pages.':
        'Um PDF deve conter entre 1 e 500 páginas.',
    'PDF page dimensions must be between 1 and 2000 mm.':
        'As dimensões da página do PDF devem estar entre 1 e 2000 mm.',
    'Choose a resolution of 203, 300 or 600 dpi.':
        'Escolha uma resolução de 203, 300 ou 600 dpi.',
    'Choose a valid PDF page number.':
        'Escolha um número de página de PDF válido.',
    'This PDF page is too large at this resolution. Choose a lower dpi (maximum 4 million pixels).':
        'Esta página do PDF é muito grande nesta resolução. Escolha um dpi menor (máximo de 4 milhões de pixels).',

    "BLE needs the 'bleak' package:  pip install bleak": "Bluetooth LE requer o pacote 'bleak':  pip install bleak",
    "Printer not found over Bluetooth. It must be on, in range and not connected to another device (e.g. a phone).":
        "Impressora não encontrada via Bluetooth. Ela precisa estar ligada, ao alcance e não conectada a outro dispositivo (ex.: um celular).",
    "No writable Bluetooth characteristic found on this device.": "Nenhuma característica Bluetooth gravável encontrada neste dispositivo.",
    "This printer does not report status over Bluetooth.": "Esta impressora não reporta status via Bluetooth.",
    "Enter the printer's IP address.": "Digite o endereço IP da impressora.",
    "Could not reach %s:%d (%s)": "Não foi possível acessar %s:%d (%s)",
    "Choose a system printer (queue).": "Escolha uma impressora do sistema (fila).",
    "Windows printing needs pywin32:  pip install pywin32": "A impressão no Windows requer pywin32:  pip install pywin32",
    "The 'lp' command (CUPS) was not found.": "O comando 'lp' (CUPS) não foi encontrado.",
    "lp failed: %s": "lp falhou: %s",
    "The 'lpstat' command (CUPS) was not found.": "O comando 'lpstat' (CUPS) não foi encontrado.",
    "Enter the device path, e.g. /dev/usb/lp0": "Digite o caminho do dispositivo, ex.: /dev/usb/lp0",
    "No permission for %s. Add yourself to the 'lp' group:  sudo usermod -aG lp $USER  (then log out and in)":
        "Sem permissão para %s. Adicione-se ao grupo 'lp':  sudo usermod -aG lp $USER  (depois saia e entre novamente)",
    "Could not open %s (%s)": "Não foi possível abrir %s (%s)",
    "Serial ports need pyserial:  pip install pyserial": "Portas seriais requerem pyserial:  pip install pyserial",
    "Choose a serial port (e.g. /dev/rfcomm0, /dev/ttyUSB0 or COM3).": "Escolha uma porta serial (ex.: /dev/rfcomm0, /dev/ttyUSB0 ou COM3).",
    "Serial port error: %s": "Erro na porta serial: %s",
    "Enter a command that reads ZPL from standard input, e.g. zebra-print": "Digite um comando que leia ZPL da entrada padrão, ex.: zebra-print",
    "Command not found: %s": "Comando não encontrado: %s",
    "%s exited with code %d: %s": "%s terminou com o código %d: %s",
    "Unknown connection type: %s": "Tipo de conexão desconhecido: %s",
    "Status can only be read over network, serial or Bluetooth LE.": "O status só pode ser lido via rede, serial ou Bluetooth LE.",
    "Search is not available for this connection type.": "A busca não está disponível para este tipo de conexão.",
    "The printer did not answer the status request.": "A impressora não respondeu à solicitação de status.",
    # server
    "No printer selected. Add one under Printers.": "Nenhuma impressora selecionada. Adicione uma em Impressoras.",
    "Nothing to send.": "Nada para enviar.",
    "Sent %d bytes to %s.": "%d bytes enviados para %s.",
    "Connected: %s": "Conectado: %s",
    "Disconnected.": "Desconectado.",
    "Only Bluetooth LE printers keep a connection open.": "Somente impressoras Bluetooth LE mantêm uma conexão aberta.",
    "Printer is ready.": "Impressora pronta.",
    "Labelary error %d: %s": "Erro do Labelary %d: %s",
    "Could not reach Labelary (is the internet on?): %s": "Não foi possível acessar o Labelary (a internet está ligada?): %s",
    "Unexpected error: %s": "Erro inesperado: %s",
}

DICTS = {
    "tr": TR,
    "pt": PT,
    "pt-br": PT,
    "pt_br": PT,
}

# Messages whose arguments appear in a different order in Turkish.
# "Sent %d bytes to %s." → "%s yazıcısına %d bayt gönderildi." (printer first, bytes last).
# Brazilian Portuguese keeps the English order ("%d bytes enviados para %s."),
# so PT does not need an entry here.
REORDER = {"Sent %d bytes to %s.": (1, 0)}


def localize(template, params, lang):
    code = (lang or "").strip().lower()
    d = DICTS.get(code)
    if d is None:
        return template % params if params else template
    t = d.get(template, template)
    # reorder is only applied for Turkish (matches previous behaviour)
    if code == "tr" and params and template in REORDER:
        params = tuple(params[i] for i in REORDER[template])
    try:
        return t % params if params else template
    except (TypeError, ValueError):
        return template % params if params else template