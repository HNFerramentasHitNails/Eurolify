"""Compara os pixels de pares de imagens (o original e o limpo).

Uso: python3 -I comparar.py original limpo [original limpo ...]
Sai com 0 se todos forem iguais; 3 se não houver o Pillow; 1 se algum
diferir (e diz qual).
"""
import sys

try:
    from PIL import Image, ImageSequence
except ModuleNotFoundError:
    sys.exit(3)

args = sys.argv[1:]
mal = []
for o, l in zip(args[::2], args[1::2]):
    a = [f.convert("RGBA").tobytes() for f in ImageSequence.Iterator(Image.open(o))]
    b = [f.convert("RGBA").tobytes() for f in ImageSequence.Iterator(Image.open(l))]
    if a != b:
        mal.append(o)
if mal:
    print("diferentes: " + ", ".join(mal))
    sys.exit(1)
