#!/usr/bin/env python3
"""Draw blocker algorithm test case brackets as a diagram."""
import os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch

# Dark theme colors matching PoolRadar
BG = '#0f172a'
PANEL = '#1e293b'
BORDER = '#475569'
BYE_BG = '#1e1b4b'
BYE_BD = '#818cf8'
ALICE_BG = '#14532d'
ALICE_BD = '#22c55e'
TXT = '#e2e8f0'
DIM = '#94a3b8'
GREEN = '#4ade80'
RED = '#f87171'
AMBER = '#fbbf24'
ARR = '#64748b'

BW, BH = 2.0, 0.75  # box width/height


def draw_box(ax, x, y, mid, p1, p2, bye=False, alice=False):
    bg, bd = (BYE_BG, BYE_BD) if bye else (ALICE_BG, ALICE_BD) if alice else (PANEL, BORDER)
    ax.add_patch(FancyBboxPatch(
        (x - BW/2, y - BH/2), BW, BH,
        boxstyle="round,pad=0.06", fc=bg, ec=bd, lw=1.5))
    if bye:
        ax.text(x, y, f'M{mid}  BYE', ha='center', va='center',
                fontsize=7.5, color=BYE_BD, fontstyle='italic', fontweight='bold')
    else:
        ax.text(x, y + 0.16, f'M{mid}', ha='center', va='center', fontsize=6.5, color=DIM)
        p1t = p1 or 'TBD'
        p2t = p2 or ('??' if alice else 'TBD')
        c1 = AMBER if not p1 else (GREEN if alice and p1 == 'Alice' else TXT)
        c2 = DIM if alice and not p2 else (AMBER if not p2 else TXT)
        ax.text(x - 0.05, y - 0.16, p1t, ha='right', va='center', fontsize=7.5, color=c1, fontweight='bold')
        ax.text(x, y - 0.16, ' v ', ha='center', va='center', fontsize=6.5, color=DIM)
        ax.text(x + 0.05, y - 0.16, p2t, ha='left', va='center', fontsize=7.5, color=c2, fontweight='bold')


def draw_arr(ax, x1, y1, x2, y2, label='W'):
    color = GREEN if label == 'W' else RED
    ax.annotate('', xy=(x2 - BW/2 - 0.05, y2), xytext=(x1 + BW/2 + 0.05, y1),
                arrowprops=dict(arrowstyle='->', color=ARR, lw=1.0,
                                connectionstyle='arc3,rad=0'))
    mx = (x1 + BW/2 + x2 - BW/2) / 2
    my = (y1 + y2) / 2
    ax.text(mx, my + 0.18, label, ha='center', va='center', fontsize=7.5,
            color=color, fontweight='bold')


# ── Test case definitions ──
# Each: (title, description, nodes_list, edges_list, expected_lines)
# node: (x, y, match_id, p1, p2, bye, alice)
# edge: (from_idx, to_idx, label)

SP = 3.0  # horizontal spacing

cases = [
    # ── A1: Both resolved, no bye ──
    ('A1: Both resolved',
     'No bye',
     [(0, 0, 1, 'Bob', 'Carol', False, False),
      (SP, 0, 2, 'Alice', None, False, True)],
     [(0, 1, 'W')],
     ['[wait] W of Bob vs Carol']),

    # ── A2: Both resolved, with bye ──
    ('A2: Both resolved',
     'With bye',
     [(0, 0, 1, 'Bob', 'Carol', False, False),
      (SP, 0, 3, None, None, True, False),
      (2*SP, 0, 2, 'Alice', None, False, True)],
     [(0, 1, 'W'), (1, 2, 'W')],
     ['[wait] W of Bob vs Carol']),

    # ── B1: One TBD → 2 real, no bye ──
    ('B1: One TBD → 2 real',
     'No bye',
     [(0, 0, 2, 'Dan', 'Eve', False, False),
      (SP, 0, 1, 'Bob', None, False, False),
      (2*SP, 0, 3, 'Alice', None, False, True)],
     [(0, 1, 'W'), (1, 2, 'W')],
     ['[wait] W of Bob vs TBD', '  └ W of Dan vs Eve']),

    # ── B2: One TBD → 2 real, with bye ──
    ('B2: One TBD → 2 real',
     'Bye on blocker→Alice',
     [(0, 0, 2, 'Dan', 'Eve', False, False),
      (SP, 0, 1, 'Bob', None, False, False),
      (2*SP, 0, 4, None, None, True, False),
      (3*SP, 0, 3, 'Alice', None, False, True)],
     [(0, 1, 'W'), (1, 2, 'W'), (2, 3, 'W')],
     ['[wait] W of Bob vs TBD', '  └ W of Dan vs Eve']),

    # ── C1: One TBD → 1 TBD, no bye ──
    ('C1: One TBD → 1 real + 1 TBD',
     'No bye',
     [(0, 0, 2, 'Dan', None, False, False),
      (SP, 0, 1, 'Bob', None, False, False),
      (2*SP, 0, 3, 'Alice', None, False, True)],
     [(0, 1, 'W'), (1, 2, 'W')],
     ['[wait] W of Bob vs TBD', '  └ W of Dan vs TBD']),

    # ── C2: One TBD → 1 TBD, with bye ──
    ('C2: One TBD → 1 real + 1 TBD',
     'Bye on child→blocker',
     [(0, 0, 2, 'Dan', None, False, False),
      (SP, 0, 4, None, None, True, False),
      (2*SP, 0, 1, 'Bob', None, False, False),
      (3*SP, 0, 3, 'Alice', None, False, True)],
     [(0, 1, 'W'), (1, 2, 'W'), (2, 3, 'W')],
     ['[wait] W of Bob vs TBD', '  └ W of Dan vs TBD']),

    # ── D1: One TBD → 2 TBDs, no bye ──
    ('D1: One TBD → TBD vs TBD',
     'No bye',
     [(0, 0, 2, None, None, False, False),
      (SP, 0, 1, 'Bob', None, False, False),
      (2*SP, 0, 3, 'Alice', None, False, True)],
     [(0, 1, 'W'), (1, 2, 'W')],
     ['[wait] W of Bob vs TBD', '  └ W of TBD vs TBD']),

    # ── D2: One TBD → 2 TBDs, with bye ──
    ('D2: One TBD → TBD vs TBD',
     'Bye on blocker→Alice',
     [(0, 0, 2, None, None, False, False),
      (SP, 0, 1, 'Bob', None, False, False),
      (2*SP, 0, 4, None, None, True, False),
      (3*SP, 0, 3, 'Alice', None, False, True)],
     [(0, 1, 'W'), (1, 2, 'W'), (2, 3, 'W')],
     ['[wait] W of Bob vs TBD', '  └ W of TBD vs TBD']),

    # ── E1: Two TBDs, resolve both, no bye ──
    ('E1: Two TBDs → resolve both',
     'No bye',
     [(0, 0.55, 2, 'Dan', 'Eve', False, False),
      (0, -0.55, 4, 'Frank', 'Grace', False, False),
      (SP, 0, 1, None, None, False, False),
      (2*SP, 0, 3, 'Alice', None, False, True)],
     [(0, 2, 'W'), (1, 2, 'L'), (2, 3, 'W')],
     ['[wait] W of TBD vs TBD', '  └ W of Dan vs Eve', '  └ L of Frank vs Grace']),

    # ── E2: Two TBDs, resolve both, with bye ──
    ('E2: Two TBDs → resolve both',
     'Bye on blocker→Alice',
     [(0, 0.55, 2, 'Dan', 'Eve', False, False),
      (0, -0.55, 4, 'Frank', 'Grace', False, False),
      (SP, 0, 1, None, None, False, False),
      (2*SP, 0, 5, None, None, True, False),
      (3*SP, 0, 3, 'Alice', None, False, True)],
     [(0, 2, 'W'), (1, 2, 'L'), (2, 3, 'W'), (3, 4, 'W')],
     ['[wait] W of TBD vs TBD', '  └ W of Dan vs Eve', '  └ L of Frank vs Grace']),
]

# ── Draw ──
fig, axes = plt.subplots(5, 2, figsize=(22, 26))
fig.patch.set_facecolor(BG)
fig.suptitle('Blocker Algorithm Test Cases', fontsize=18, fontweight='bold',
             color=TXT, y=0.99)

# Column headers
for col, hdr in enumerate(['Without Bye', 'With Bye']):
    fig.text(0.27 + col * 0.48, 0.965, hdr, ha='center', fontsize=14,
             fontweight='bold', color=AMBER,
             transform=fig.transFigure)

for idx, (title, subtitle, nodes, edges, expected) in enumerate(cases):
    row, col = divmod(idx, 2)
    ax = axes[row][col]
    ax.set_facecolor(BG)

    # Compute bounds
    xs = [n[0] for n in nodes]
    ys = [n[1] for n in nodes]
    xmin, xmax = min(xs) - BW, max(xs) + BW
    ymin, ymax = min(ys) - 1.8, max(ys) + 1.2
    ax.set_xlim(xmin, xmax)
    ax.set_ylim(ymin, ymax)
    ax.set_aspect('equal')
    ax.axis('off')

    # Title
    ax.text((xmin + xmax) / 2, ymax - 0.15, title,
            ha='center', va='top', fontsize=10, fontweight='bold', color=TXT)
    ax.text((xmin + xmax) / 2, ymax - 0.5, subtitle,
            ha='center', va='top', fontsize=8, color=DIM, fontstyle='italic')

    # Draw edges first (behind boxes)
    for fi, ti, lbl in edges:
        fn = nodes[fi]
        tn = nodes[ti]
        draw_arr(ax, fn[0], fn[1], tn[0], tn[1], lbl)

    # Draw nodes
    for x, y, mid, p1, p2, bye, alice in nodes:
        draw_box(ax, x, y, mid, p1, p2, bye=bye, alice=alice)

    # Expected output
    ey = ymin + 0.3
    ax.text(xmin + 0.3, ey + len(expected) * 0.28, 'Expected:', ha='left', va='top',
            fontsize=7.5, color=DIM, fontstyle='italic')
    for i, line in enumerate(expected):
        ax.text(xmin + 0.3, ey + (len(expected) - 1 - i) * 0.28, line,
                ha='left', va='top', fontsize=8, color=TXT,
                fontfamily='monospace')

# Legend
legend_y = 0.015
for x, label, bg, bd in [
    (0.15, 'Unresolved Match', PANEL, BORDER),
    (0.38, 'BYE (skipped)', BYE_BG, BYE_BD),
    (0.61, "Alice's Pending Match", ALICE_BG, ALICE_BD),
]:
    fig.patches.append(FancyBboxPatch(
        (x - 0.015, legend_y - 0.004), 0.03, 0.012,
        boxstyle="round,pad=0.002", fc=bg, ec=bd, lw=1.5,
        transform=fig.transFigure))
    fig.text(x + 0.025, legend_y + 0.002, label, fontsize=9, color=TXT,
             va='center', transform=fig.transFigure)

# TBD color note
fig.text(0.84, legend_y + 0.002, 'TBD = amber text', fontsize=9, color=AMBER,
         va='center', transform=fig.transFigure)

plt.tight_layout(rect=[0, 0.03, 1, 0.96])
plt.savefig(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'test_cases.png'), dpi=150,
            facecolor=BG, bbox_inches='tight')
print('Saved to test_cases.png')
