"""Limited, explicit NLBL interchange based on a user-provided ZebraDesigner 3 sample.

This is an independent compatibility implementation, not a Zebra SDK.
Unsupported designs fail rather than silently dropping objects.
"""
import base64
import copy
import io
import math
import re
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path

PASSWORD = b",^_A5Fus&!?j='Epiq*e"
SEED = Path(__file__).parent / "static" / "nlbl"
LIMIT = 20 * 1024 * 1024


def _zip():
    try:
        import pyzipper
        return pyzipper
    except ImportError as e:
        raise ValueError("NLBL desteği için pyzipper paketi gerekli.") from e


def _xml(data):
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise ValueError("Bu XML yapısı desteklenmiyor.")
    return ET.fromstring(data)


def _text(node, key, default=""):
    return node.findtext(key, default)


def _number(node, key, default=0):
    v = float(_text(node, key, str(default)))
    if not math.isfinite(v):
        raise ValueError("Geçersiz sayısal değer")
    return v


def _set(node, key, value):
    target = node
    for part in key.split("/"):
        child = target.find(part)
        if child is None:
            child = ET.SubElement(target, part)
        target = child
    target.text = str(value)
    return target


def _image_png(raw):
    from PIL import Image, UnidentifiedImageError
    if len(raw) > 8 * 1024 * 1024:
        raise ValueError("Görsel en fazla 8 MB olabilir.")
    try:
        with Image.open(io.BytesIO(raw)) as image:
            if image.width * image.height > 4_000_000:
                raise ValueError("Görsel en fazla 4 milyon piksel olabilir.")
            if image.format not in ("PNG", "JPEG", "BMP", "GIF", "WEBP", "TIFF"):
                raise ValueError("Görsel biçimi desteklenmiyor.")
            output = io.BytesIO()
            image.convert("RGBA").save(output, format="PNG")
            return output.getvalue()
    except (UnidentifiedImageError, OSError) as e:
        raise ValueError("Gömülü görsel okunamadı.") from e


def _fixed_value(item):
    contents = item.find("Contents")
    if contents is not None and item.find("Contents/FixedValue") is None:
        raise ValueError("Dinamik veri kaynağı henüz desteklenmiyor; sabit içerik kullan.")
    return _text(item,"Contents/FixedValue/StringValue",_text(item,"FixedContents"))


def import_label(raw):
    if len(raw) > LIMIT:
        raise ValueError("NLBL dosyası en fazla 20 MB olabilir.")
    pz = _zip()
    try:
        with pz.AESZipFile(io.BytesIO(raw)) as z:
            infos = z.infolist()
            if len(infos) > 100 or sum(i.file_size for i in infos) > LIMIT:
                raise ValueError("NLBL içeriği çok büyük.")
            formats = [i.filename for i in infos if i.filename.startswith("Formats/")]
            if len(formats) != 1:
                raise ValueError("Yalnızca tek etiket tasarımı içeren NLBL dosyaları destekleniyor.")
            root = _xml(z.read(formats[0], pwd=PASSWORD))
    except ValueError:
        raise
    except (pz.BadZipFile, RuntimeError, KeyError, OSError, ET.ParseError) as e:
        raise ValueError("Bu dosya geçerli bir ZebraDesigner 3 (.nlbl) dosyası değil.") from e
    designs = root.findall("DocumentDesigns/DocumentDesign")
    if len(designs) != 1:
        raise ValueError("Yalnızca tek tasarımlı etiketler destekleniyor.")
    items = root.find("DocumentDesigns/DocumentDesign/Items")
    if items is None:
        raise ValueError("Etiket tasarımı bulunamadı.")
    printer = _text(root, "PrintScenarioCollection/PrintScenarioCollection/Printer/Name")
    dpi_match = re.search(r"(203|300|600)\s*dpi", printer, re.I)
    dpi = int(dpi_match[1]) if dpi_match else 300
    label = {"id": uuid.uuid4().hex[:10], "name": _text(root,"Name","Etiket"),
             "w": _number(root,"Media/Width")/1000, "h": _number(root,"Media/Height")/1000,
             "dpi": dpi, "elements": []}
    warnings = []
    if root.find("DataSources") is not None or root.find("Variables") is not None:
        raise ValueError("Veri kaynağı içeren NLBL tasarımları bu sürümde desteklenmiyor.")
    for item in sorted(items, key=lambda item: _number(item,"ZOrder")):
        kind = item.get("Type")
        geo = item.find("Geometry")
        if geo is None:
            raise ValueError("Geometrisi olmayan öğe desteklenmiyor.")
        if _number(geo,"Rotation",0) != 0:
            raise ValueError("Döndürülmüş NLBL öğeleri henüz desteklenmiyor.")
        e = {"id":uuid.uuid4().hex[:10], "name":_text(item,"Name"),
             "x": _number(geo,"X",_number(geo,"Left"))/1000,
             "y": _number(geo,"Y",_number(geo,"Top"))/1000}
        if kind == "TextDocumentItem":
            if item.find("Contents") is not None and item.find("Contents/FixedValue") is None:
                raise ValueError("Değişken veri içeren metin henüz desteklenmiyor.")
            value = _text(item,"Contents/FixedValue/StringValue",_text(item,"FixedContents"))
            e.update(type="text",text=value,size=round(_number(item,"FontDescriptor/Height",10)*25.4/72,4),
                     bold=_number(item,"FontDescriptor/LogFontWrapper/Weight",400)>=700, widthPct=100)
            face = _text(item,"FontDescriptor/Name", "ZEBRA 0")
            fonts = {"Arial", "Calibri", "Segoe UI", "Tahoma", "Verdana", "Times New Roman", "Courier New"}
            e["font"] = face if face in fonts else "zebra"
            if face != "ZEBRA 0" and face not in fonts:
                warnings.append("Desteklenmeyen yazı tipi ZebraApp yazı tipine uyarlandı; yerleşimi kontrol et.")
        elif kind == "BarcodeDocumentItem":
            bd = item.find("BarcodeData")
            barcode_type = bd.get("Type") if bd is not None else ""
            module = max(1, round(_number(bd,"BaseBarWidth",254)*dpi/25400))
            value = _fixed_value(item)
            if barcode_type == "QRBarcodeData":
                level = int(_number(bd,"QRBarcodeErrorCorrectionLevel",0))
                if level not in range(4):
                    raise ValueError("QR hata düzeltme seviyesi geçersiz.")
                if module > 10:
                    raise ValueError("QR modülü ZebraApp sınırını aşıyor (en fazla 10 nokta).")
                e.update(type="qr",data=value,mag=module,ec="LMQH"[level])
                if _number(bd,"QRBarcodeVersion",0) or _number(bd,"QRBarcodeEncoding",0):
                    warnings.append("QR sürümü ve kodlaması otomatik seçilir; basmadan önce boyutunu kontrol et.")
            elif barcode_type in ("Code128BarcodeData", "Code39BarcodeData", "EAN13BarcodeData", "Ean13BarcodeData"):
                barcode_kind = {"Code128BarcodeData":"code128", "Code39BarcodeData":"code39", "EAN13BarcodeData":"ean13", "Ean13BarcodeData":"ean13"}[barcode_type]
                position = int(_number(bd,"HumanInterpretationPosition",1))
                e.update(type="barcode",kind=barcode_kind,data=value,
                         h=_number(bd,"ModuleHeight",10000)/1000,
                         module=module,human=position!=0,humanAbove=position==2)
            else:
                raise ValueError("Desteklenmeyen barkod türü: " + str(barcode_type))
        elif kind == "GraphicDocumentItem":
            encoded = _text(item,"EmbeddedGraphicContents/Base64StringValue")
            if not encoded:
                raise ValueError("Görsel dosyaya gömülü değil. Gönderen ZebraDesigner'da 'Belge içine katışmış resim' seçeneğini kullanmalı.")
            png = _image_png(base64.b64decode(encoded,validate=True))
            e.update(type="image",src="data:image/png;base64,"+base64.b64encode(png).decode("ascii"),
                     w=_number(geo,"Width")/1000,h=_number(geo,"Height")/1000,
                     keepAspect=_text(item,"KeepAspectRatio","True")=="True",threshold=128)
        elif kind == "RectangleDocumentItem":
            w,h=_number(geo,"Width")/1000,_number(geo,"Height")/1000
            e.update(type="box",w=w,h=h,t=_number(item,"Thickness",300)/1000,
                     filled=_number(item,"FillStyle",0)!=0,
                     round=max(0,min(8,round(_number(item,"Radius",0)/1000*16/max(0.001,min(w,h))))))
        elif kind == "EllipseDocumentItem":
            rx,ry=_number(geo,"RadiusX")/1000,_number(geo,"RadiusY")/1000
            e.update(type="ellipse",x=_number(geo,"CenterPointX")/1000-rx,
                     y=_number(geo,"CenterPointY")/1000-ry,w=rx*2,h=ry*2,
                     t=_number(item,"Thickness",300)/1000,filled=_number(item,"FillStyle",0)!=0)
        elif kind == "LineDocumentItem":
            x1,y1=_number(geo,"StartPointX")/1000,_number(geo,"StartPointY")/1000
            x2,y2=_number(geo,"EndPointX")/1000,_number(geo,"EndPointY")/1000
            thick=_number(item,"Thickness",300)/1000
            if abs(y2-y1)<0.001:
                e.update(type="line",x=min(x1,x2),y=y1-thick/2,dir="h",len=abs(x2-x1),t=thick)
            elif abs(x2-x1)<0.001:
                e.update(type="line",x=x1-thick/2,y=min(y1,y2),dir="v",len=abs(y2-y1),t=thick)
            else:
                raise ValueError("Eğik çizgiler henüz desteklenmiyor.")
        else:
            raise ValueError("Desteklenmeyen NLBL öğesi: " + str(kind) + ". Dosya değiştirilmedi.")
        if kind in ("RectangleDocumentItem", "EllipseDocumentItem", "LineDocumentItem"):
            if _number(item,"LineStyle",1) != 1 or _number(item,"FillStyle",0) not in (0,1):
                raise ValueError("Desenli çizgi ve dolgular henüz desteklenmiyor.")
        label["elements"].append(e)
    warnings.append("NLBL aktarımı deneysel: yazı boyutu, barkod ve baskı ayarlarını kontrol et.")
    return label, list(dict.fromkeys(warnings))


def export_label(label):
    pz = _zip()
    if label.get("dpi") != 300:
        raise ValueError("NLBL dışa aktarımı şu anda örnekle doğrulanan 300 dpi ile sınırlı.")
    for key in ("w","h"):
        if not isinstance(label.get(key),(float,int)) or not 1 <= label[key] <= 2000:
            raise ValueError("Etiket boyutu geçersiz.")
    elements = label.get("elements",[])
    if not isinstance(elements,list) or len(elements)>2000:
        raise ValueError("Etiket öğeleri geçersiz.")
    root = _xml((SEED/"format.xml").read_bytes())
    solution = _xml((SEED/"solution.xml").read_bytes())
    name = str(label.get("name") or "Etiket")[:80]
    file_name = re.sub(r'[^\w .-]', '_', name).strip('.') or "Etiket"
    for node in (root,solution):
        _set(node,"Id",uuid.uuid4());_set(node,"Name",name);_set(node,"MergeName",name)
    _set(root,"Media/RfidTag/FormatReference/Id",_text(root,"Id"))
    _set(solution,"SolutionSummary/SolutionName",name)
    _set(solution,"SolutionSummary/HasErrors","False")
    for key in ("OriginalFileName","OriginalTimeStamp"):
        child=root.find(key)
        if child is not None:root.remove(child)
    for key,val in (("Width",label["w"]),("Height",label["h"])):
        _set(root,"Media/"+key,round(val*1000))
        _set(root,"PageLayout/Element"+key,round(val*1000))
        _set(root,"DocumentDesigns/DocumentDesign/"+key,round(val*1000))
    items=root.find("DocumentDesigns/DocumentDesign/Items")
    text_seed=copy.deepcopy(items[0]); barcode_seed=copy.deepcopy(items[1]);items.clear()
    warnings=["NLBL aktarımı: yazı tipleri, satır kaydırma ve baskı ayarlarını ZebraDesigner'da kontrol et."]
    for i,e in enumerate(elements):
        if e.get("hidden"):
            raise ValueError("Gizli öğeleri NLBL dışa aktarmadan önce kaldır veya görünür yap.")
        if e.get("rot",0) or e.get("reverse"):
            raise ValueError("Döndürme ve ters baskı NLBL aktarımında henüz desteklenmiyor.")
        for key in ("x", "y"):
            if not isinstance(e.get(key), (int,float)) or not math.isfinite(e[key]):
                raise ValueError("Öğe konumu geçersiz.")
        kind=e.get("type")
        if kind=="text":
            item=copy.deepcopy(text_seed)
            value=str(e.get("text", ""))
            if '{' in value: warnings.append("Süslü parantezli alanlar ZebraDesigner'a sabit metin olarak aktarılır.")
            _set(item,"FixedContents",value);_set(item,"Contents/FixedValue/StringValue",value)
            face = e.get("font", "zebra")
            if face not in {"Arial", "Calibri", "Segoe UI", "Tahoma", "Verdana", "Times New Roman", "Courier New"}:
                face = "ZEBRA 0"
            _set(item,"FontDescriptor/Name",face)
            _set(item,"FontDescriptor/LogFontWrapper/FaceName",face)
            _set(item,"FontDescriptor/Height",round(float(e.get("size",4))*72/25.4,4))
            _set(item,"FontDescriptor/LogFontWrapper/Height",-round(float(e.get("size",4))*300/25.4))
            _set(item,"FontDescriptor/LogFontWrapper/Weight",700 if e.get("bold") else 400)
            if e.get("wrap") or e.get("align","left")!="left" or e.get("widthPct",100)!=100:
                warnings.append("Metin kaydırma, hizalama ve harf genişliği birebir taşınmaz; ZebraDesigner'da kontrol et.")
        elif kind=="barcode" and e.get("kind","code128")=="code128":
            item=copy.deepcopy(barcode_seed)
            _set(item,"FixedContents",str(e.get("data","")))
            _set(item,"SampleValue/StringValue",str(e.get("data","")))
            _set(item,"SampleValue/UserValue",str(e.get("data","")))
            _set(item,"BarcodeData/BaseBarWidth",float(e.get("module",3))*25400/300)
            _set(item,"BarcodeData/UserBarWidth",float(e.get("module",3))*25400/300)
            _set(item,"BarcodeData/ModuleHeight",float(e.get("h",10))*1000)
            _set(item,"BarcodeData/HumanInterpretationPosition",0 if not e.get("human",True) else (2 if e.get("humanAbove") else 1))
        elif kind=="qr":
            item=_xml((SEED/"qr.xml").read_bytes())
            value=str(e.get("data",""))
            _set(item,"FixedContents",value)
            _set(item,"SampleValue/StringValue",value);_set(item,"SampleValue/UserValue",value)
            level=str(e.get("ec","M"))
            if level not in "LMQH" or len(level)!=1:
                raise ValueError("QR hata düzeltme seviyesi geçersiz.")
            mag=float(e.get("mag",5))
            if not 1<=mag<=10 or int(mag)!=mag:raise ValueError("QR modülü 1–10 arasında tam sayı olmalı.")
            _set(item,"BarcodeData/QRBarcodeErrorCorrectionLevel","LMQH".index(level))
            _set(item,"BarcodeData/BaseBarWidth",mag*25400/300)
            _set(item,"BarcodeData/UserBarWidth",mag*25400/300)
            _set(item,"BarcodeData/CodePage",65001)
        elif kind in ("image","box","ellipse","line"):
            item=_xml((SEED/(kind+".xml")).read_bytes())
            geo=item.find("Geometry")
            x,y=float(e.get("x",0)),float(e.get("y",0))
            if kind=="image":
                source=str(e.get("src",""))
                if not re.match(r"^data:image/(png|jpeg|webp|gif|bmp|tiff);base64,",source,re.I):
                    raise ValueError("Görsel dosya içine gömülü olmalı.")
                png=_image_png(base64.b64decode(source.split(",",1)[1],validate=True))
                _set(item,"GraphicFileName","image.png")
                _set(item,"EmbeddedGraphicContents/Base64StringValue",base64.b64encode(png).decode("ascii"))
                _set(item,"KeepAspectRatio","True" if e.get("keepAspect",True) else "False")
                if e.get("invert") or e.get("dither") or e.get("rot",0) or e.get("threshold",128)!=128:
                    raise ValueError("Görsel baskı görünümü hazırlanamadı. Güncel ZebraApp arayüzünü kullan.")
            if kind in ("image","box","ellipse"):
                w,h=float(e.get("w",20)),float(e.get("h",10))
                if not 0<w<=2000 or not 0<h<=2000:raise ValueError("Öğe boyutu geçersiz.")
                if kind=="ellipse":
                    for k,v in (("CenterPointX",x+w/2),("CenterPointY",y+h/2),("RadiusX",w/2),("RadiusY",h/2)):_set(geo,k,round(v*1000))
                else:
                    for k,v in (("Left",x),("Top",y),("Width",w),("Height",h)):_set(geo,k,round(v*1000))
                if kind=="box":_set(item,"Radius",float(e.get("round",0))*min(w,h)*1000/16)
            if kind in ("box","ellipse","line"):
                thick=float(e.get("t",0.3))
                if not 0<thick<=100:raise ValueError("Çizgi kalınlığı geçersiz.")
                _set(item,"Thickness",round(thick*1000))
                _set(item,"FillStyle",1 if e.get("filled") else 0)
            if kind=="line":
                length=float(e.get("len",30))
                if not 0<length<=2000:raise ValueError("Çizgi uzunluğu geçersiz.")
                vertical=e.get("dir")=="v"
                x1,y1=x+(thick/2 if vertical else 0),y+(0 if vertical else thick/2)
                x2,y2=x1+(0 if vertical else length),y1+(length if vertical else 0)
                for k,v in (("StartPointX",x1),("StartPointY",y1),("EndPointX",x2),("EndPointY",y2)):_set(geo,k,round(v*1000))
        else:
            raise ValueError("Desteklenmeyen NLBL öğesi: "+str(kind))
        _set(item,"Id",uuid.uuid4());_set(item,"Name",e.get("name") or f"Öğe {i+1}")
        _set(item,"MergeName",e.get("name") or f"Öğe {i+1}");_set(item,"ZOrder",10001+i)
        if kind in ("text","barcode","qr"):
            _set(item,"Geometry/X",round(float(e.get("x",0))*1000));_set(item,"Geometry/Y",round(float(e.get("y",0))*1000))
        items.append(item)
    output=io.BytesIO()
    with pz.AESZipFile(output,"w",compression=pz.ZIP_DEFLATED,encryption=pz.WZ_AES) as z:
        z.setpassword(PASSWORD)
        z.writestr("Formats/"+file_name,ET.tostring(root,encoding="utf-8",xml_declaration=True))
        z.writestr(file_name+".slnx",ET.tostring(solution,encoding="utf-8",xml_declaration=True))
    return output.getvalue(),list(dict.fromkeys(warnings))
