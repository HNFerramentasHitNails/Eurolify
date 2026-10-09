"""Gera as imagens de teste dos metadados (docs/14 §3.5, issue #179).

Corre-se à mão, só para as refazer: python3 -I gerar.py (precisa do Pillow).
Imagens inventadas, 16 x 16, sem nada de real: o GPS é o de um ponto no mar.
"""
import io
from pathlib import Path

from PIL import Image, PngImagePlugin

AQUI = Path(__file__).parent
XMP = b'<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Autor de Teste</dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>'


def imagem():
    im = Image.new("RGB", (16, 16))
    for x in range(16):
        for y in range(16):
            im.putpixel((x, y), (x * 16, y * 16, 128))
    return im


def exif(orientacao=None):
    e = Image.Exif()
    e[0x010F] = "Fabricante de Teste"  # Make
    e[0x0110] = "Telemovel de Teste"  # Model
    e[0x0132] = "2026:10:09 10:00:00"  # DateTime
    if orientacao is not None:
        e[0x0112] = orientacao
    gps = {1: "N", 2: (38.0, 30.0, 0.0), 3: "W", 4: (12.0, 0.0, 0.0)}
    e[0x8825] = gps
    return e


im = imagem()
# JPEG com EXIF (GPS, aparelho, orientação 6), XMP e um comentário.
b = io.BytesIO()
im.save(b, "JPEG", exif=exif(6), xmp=XMP, comment=b"comentario de teste", quality=90)
(AQUI / "com-gps.jpg").write_bytes(b.getvalue())
# JPEG progressivo, com EXIF sem orientação.
b = io.BytesIO()
im.save(b, "JPEG", exif=exif(), progressive=True, quality=90)
(AQUI / "progressivo-com-gps.jpg").write_bytes(b.getvalue())
# PNG com texto, iTXt, eXIf e tIME.
info = PngImagePlugin.PngInfo()
info.add_text("Author", "Autor de Teste")
info.add_itxt("Description", "descricao de teste", lang="pt")
b = io.BytesIO()
im.save(b, "PNG", pnginfo=info, exif=exif())
dados = bytearray(b.getvalue())
# tIME antes do IEND.
import struct, zlib
tipo = b"tIME"
corpo = struct.pack(">HBBBBB", 2026, 10, 9, 10, 0, 0)
time = struct.pack(">I", len(corpo)) + tipo + corpo + struct.pack(">I", zlib.crc32(tipo + corpo))
fim = dados.rfind(b"IEND") - 4
dados[fim:fim] = time
(AQUI / "com-texto.png").write_bytes(bytes(dados))
# WebP com EXIF e XMP.
b = io.BytesIO()
im.save(b, "WEBP", exif=exif(), xmp=XMP, lossless=True)
(AQUI / "com-exif.webp").write_bytes(b.getvalue())
# Sem metadados nenhuns: as imagens comuns dos testes da media.
b = io.BytesIO()
im.save(b, "JPEG", quality=90)
(AQUI / "limpa.jpg").write_bytes(b.getvalue())
b = io.BytesIO()
im.save(b, "WEBP", lossless=True)
(AQUI / "limpa.webp").write_bytes(b.getvalue())
# Revisão do #215: os blocos que têm de ficar, e uma animação.
from PIL import ImageCms

icc = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
grande = Image.new("RGB", (64, 64))
for x in range(64):
    for y in range(64):
        grande.putpixel((x, y), (x * 4, y * 4, (x + y) * 2))
# JPEG com perfil de cor, reinícios (DRI e RSTn) e EXIF com orientação 3.
b = io.BytesIO()
grande.save(b, "JPEG", icc_profile=icc, restart_marker_blocks=1, exif=exif(3), quality=90)
(AQUI / "icc-reinicios.jpg").write_bytes(b.getvalue())
# JPEG CMYK (o Adobe APP14 diz como converter a cor).
b = io.BytesIO()
grande.convert("CMYK").save(b, "JPEG", quality=90)
(AQUI / "cmyk.jpg").write_bytes(b.getvalue())
# PNG com perfil de cor, transparência, gama e densidade, e um texto.
info = PngImagePlugin.PngInfo()
info.add_text("Author", "Autor de Teste")
b = io.BytesIO()
im.convert("P").save(b, "PNG", icc_profile=icc, transparency=0, dpi=(300, 300), pnginfo=info)
(AQUI / "cor.png").write_bytes(b.getvalue())
# WebP animado (duas molduras) com EXIF e XMP.
b = io.BytesIO()
im.save(b, "WEBP", save_all=True, append_images=[im.rotate(90)], duration=100, exif=exif(), xmp=XMP, lossless=True)
(AQUI / "animado.webp").write_bytes(b.getvalue())
