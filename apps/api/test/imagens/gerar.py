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
