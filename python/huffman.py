import sys
import json
import heapq
import base64
import io
from collections import defaultdict
import matplotlib.pyplot as plt
import networkx as nx

# ======================================
# HUFFMAN TREE CLASS DESIGN BY NGOC ANH 
# ======================================

# -------------- NODE CÂY HUFFMAN --------------
class Node:
    def __init__(self, char=None, freq=0):
        self.char = char
        self.freq = freq
        self.left = None
        self.right = None

    def __lt__(self, other):
        return self.freq < other.freq

# -------------- TÍNH TẦN SỐ --------------
def calculate_frequency(text):
    freq = defaultdict(int)
    for char in text:
        freq[char] += 1
    return freq

# ----------- TÍNH XÁC SUẤT --------------
def calculate_probabilities(freq_dict):
    total = sum(freq_dict.values())
    return {char: freq / total for char, freq in freq_dict.items()}

# ----------- BUILD TREE HUFFMAN VÀ GHI LẠI TẤT CẢ CÁC BƯỚc XÂY DỰNG -----------
def build_huffman_tree(freq_dict):
    heap = [Node(char, freq) for char, freq in freq_dict.items()]
    heapq.heapify(heap)

    steps = []

    def snapshot(heap):
        return sorted([(n.char if n.char else "*", n.freq) for n in heap], key=lambda x: x[1])

    steps.append(snapshot(heap))

    while len(heap) > 1:
        n1 = heapq.heappop(heap)
        n2 = heapq.heappop(heap)
        merged = Node(freq=n1.freq + n2.freq)
        merged.left = n1
        merged.right = n2
        heapq.heappush(heap, merged)

        steps.append(snapshot(heap))

    formatted_steps = [
        {"step": i, "heap": [[s, float(f)] for s, f in stage]}
        for i, stage in enumerate(steps)
    ]
    
    return heap[0], formatted_steps

# ----------- MÃ HÓA -----------
def generate_codes(root):
    codes = {}
    def dfs(node, code=''):
        if node:
            if node.char is not None:
                codes[node.char] = code
            dfs(node.left, code + '0')
            dfs(node.right, code + '1')
    dfs(root)
    return codes

def encode_text(text, codes):
    return ''.join(codes[char] for char in text)

# ----------- CRC32 -----------
def calculate_crc(data, poly=0x104C11DB7):
    crc = 0xFFFFFFFF
    for byte in data.encode():
        crc ^= byte << 24
        for _ in range(8):
            if crc & 0x80000000:
                crc = (crc << 1) ^ poly
            else:
                crc <<= 1
            crc &= 0xFFFFFFFF
    return crc ^ 0xFFFFFFFF

# ----------- Vẻ CÂY TRẢ BASE64 -----------
def draw_tree_base64(root):
    G = nx.DiGraph()
    labels = {}
    edge_labels = {}
    pos = {}

    def build_graph(node, x=0, y=0, dx=1.0):
        if node is None:
            return
        node_id = id(node)
        label = f"{repr(node.char)} ({node.freq})" if node.char else f"* ({node.freq})"
        labels[node_id] = label
        pos[node_id] = (x, -y)

        if node.left:
            G.add_edge(node_id, id(node.left))
            edge_labels[(node_id, id(node.left))] = '0'
            build_graph(node.left, x - dx, y + 1, dx / 1.5)
        if node.right:
            G.add_edge(node_id, id(node.right))
            edge_labels[(node_id, id(node.right))] = '1'
            build_graph(node.right, x + dx, y + 1, dx / 1.5)

    build_graph(root)

    plt.figure(figsize=(15, 8))
    nx.draw(G, pos, labels=labels, with_labels=True,
            node_size=2000, node_color="white", edgecolors="black",
            font_size=10, font_family="monospace", arrows=False)
    nx.draw_networkx_edge_labels(G, pos, edge_labels=edge_labels, font_color="gray")
    plt.axis("off")

    buf = io.BytesIO()
    plt.savefig(buf, format='png', bbox_inches='tight')
    plt.close()
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")

# ------------------- MAIN ------------------------
if __name__ == "__main__":
    action = sys.argv[1]
    data = sys.argv[2]

    if action == "encode":
        freq = calculate_frequency(data)
        probs = calculate_probabilities(freq)
        root, build_steps = build_huffman_tree(freq)
        codes = generate_codes(root)
        encoded_data = encode_text(data, codes)
        crc = calculate_crc(data)
        tree_base64 = draw_tree_base64(root)

        result = {
            "encoded_data": encoded_data,
            "crc": crc,
            "codes": codes,
            "tree_image_base64": tree_base64,
            "frequencies": freq,
            "probabilities": probs,
            "build_steps": build_steps
        }
        print(json.dumps(result))

    elif action == "decode":
        encoded_data = data
        codes = json.loads(sys.argv[3])
        reverse_codes = {v: k for k, v in codes.items()}

        buffer = ''
        decoded = ''
        for bit in encoded_data:
            buffer += bit
            if buffer in reverse_codes:
                decoded += reverse_codes[buffer]
                buffer = ''

        result = {
            "decoded_data": decoded
        }
        print(json.dumps(result))