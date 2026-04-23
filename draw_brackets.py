#!/usr/bin/env python3
"""Draw bracket-style diagrams for blocker algorithm test cases."""
import os
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Rectangle

# PoolRadar dark theme
BG = '#0f172a'
PANEL = '#1e293b'
BD = '#475569'
BYE_BG = '#1e1b4b'
BYE_BD = '#818cf8'
ALICE_BG = '#14532d'
ALICE_BD = '#22c55e'
TXT = '#e2e8f0'
DIM = '#94a3b8'
GREEN = '#4ade80'
RED = '#f87171'
AMBER = '#fbbf24'

MW = 2.6    # match box width
MH = 0.9   # match box total height
RS = 3.8   # round spacing
VS = 1.5   # vertical spacing multiplier


def draw_match(ax, x, y, mid, p1, p2, is_bye=False, is_alice=False):
    """Draw a bracket-style match box (two rows: p1 on top, p2 on bottom)."""
    half = MH / 2
    bg = BYE_BG if is_bye else ALICE_BG if is_alice else PANEL
    bd_c = BYE_BD if is_bye else ALICE_BD if is_alice else BD

    # Top row (p1)
    ax.add_patch(Rectangle((x, y), MW, half, fc=bg, ec=bd_c, lw=1.3, zorder=2))
    # Bottom row (p2)
    ax.add_patch(Rectangle((x, y - half), MW, half, fc=bg, ec=bd_c, lw=1.3, zorder=2))

    if is_bye:
        ax.text(x + MW / 2, y, 'BYE', ha='center', va='center',
                fontsize=9, color=BYE_BD, fontweight='bold', fontstyle='italic', zorder=3)
        ax.text(x + MW - 0.1, y + half - 0.06, f'#{mid}', ha='right', va='top',
                fontsize=5.5, color=BYE_BD, alpha=0.5, zorder=3)
    else:
        p1t = p1 or 'TBD'
        p2t = p2 or ('??' if is_alice else 'TBD')
        c1 = AMBER if not p1 else TXT
        c2 = DIM if (is_alice and not p2) else (AMBER if not p2 else TXT)

        ax.text(x + 0.14, y + half / 2, p1t, ha='left', va='center',
                fontsize=9, color=c1, fontweight='bold', zorder=3)
        ax.text(x + 0.14, y - half / 2, p2t, ha='left', va='center',
                fontsize=9, color=c2, fontweight='bold', zorder=3)
        ax.text(x + MW - 0.1, y + half - 0.06, f'#{mid}', ha='right', va='top',
                fontsize=5.5, color=DIM, zorder=3)

    return {
        'left': x, 'right': x + MW,
        'cy': y, 'p1y': y + half / 2, 'p2y': y - half / 2,
        'top': y + half, 'bot': y - half,
    }


def draw_conn(ax, src, dst, label='W', slot='bot'):
    """Draw bracket-style L-connector with W/L label."""
    x1, y1 = src['right'], src['cy']
    x2 = dst['left']
    y2 = dst['p1y'] if slot == 'top' else dst['p2y'] if slot == 'bot' else dst['cy']

    mx = (x1 + x2) / 2
    lc = BD

    ax.plot([x1, mx], [y1, y1], color=lc, lw=1.6, solid_capstyle='round', zorder=1)
    if abs(y1 - y2) > 0.01:
        ax.plot([mx, mx], [y1, y2], color=lc, lw=1.6, solid_capstyle='round', zorder=1)
    ax.plot([mx, x2], [y2, y2], color=lc, lw=1.6, solid_capstyle='round', zorder=1)

    tc = GREEN if label == 'W' else RED
    ax.text(x1 + 0.12, y1 + 0.14, label, fontsize=8, color=tc,
            fontweight='bold', va='bottom', zorder=3)


# ────────────────────────────────────────────────
# Test cases
# matches: (round, vpos, id, p1, p2, bye, alice)
# edges:   (src_idx, dst_idx, label, slot)
# ────────────────────────────────────────────────
cases = [
    # ── A: Both resolved ──
    dict(name='A1: Both resolved, no bye',
         matches=[(0, 0, 1, 'Bob', 'Carol', False, False),
                  (1, 0, 2, 'Alice', None, False, True)],
         edges=[(0, 1, 'W', 'bot')],
         expected=['[wait] W of Bob vs Carol']),

    dict(name='A2: Both resolved, with bye',
         matches=[(0, 0, 1, 'Bob', 'Carol', False, False),
                  (1, 0, 99, None, None, True, False),
                  (2, 0, 2, 'Alice', None, False, True)],
         edges=[(0, 1, 'W', 'center'), (1, 2, 'W', 'bot')],
         expected=['[wait] W of Bob vs Carol']),

    # ── B: One TBD → 2 real ──
    dict(name='B1: One TBD \u2192 2 real, no bye',
         matches=[(0, 0, 2, 'Dan', 'Eve', False, False),
                  (1, 0, 1, 'Bob', None, False, False),
                  (2, 0, 3, 'Alice', None, False, True)],
         edges=[(0, 1, 'W', 'bot'), (1, 2, 'W', 'bot')],
         expected=['[wait] W of Bob vs TBD', '  \u2514 W of Dan vs Eve']),

    dict(name='B2: One TBD \u2192 2 real, bye on blocker\u2192Alice',
         matches=[(0, 0, 2, 'Dan', 'Eve', False, False),
                  (1, 0, 1, 'Bob', None, False, False),
                  (2, 0, 99, None, None, True, False),
                  (3, 0, 3, 'Alice', None, False, True)],
         edges=[(0, 1, 'W', 'bot'), (1, 2, 'W', 'center'), (2, 3, 'W', 'bot')],
         expected=['[wait] W of Bob vs TBD', '  \u2514 W of Dan vs Eve']),

    # ── C: One TBD → 1 real + 1 TBD ──
    dict(name='C1: One TBD \u2192 1 real + 1 TBD, no bye',
         matches=[(0, 0, 2, 'Dan', None, False, False),
                  (1, 0, 1, 'Bob', None, False, False),
                  (2, 0, 3, 'Alice', None, False, True)],
         edges=[(0, 1, 'W', 'bot'), (1, 2, 'W', 'bot')],
         expected=['[wait] W of Bob vs TBD', '  \u2514 W of Dan vs TBD']),

    dict(name='C2: One TBD \u2192 1 real + 1 TBD, bye on child\u2192blocker',
         matches=[(0, 0, 2, 'Dan', None, False, False),
                  (1, 0, 99, None, None, True, False),
                  (2, 0, 1, 'Bob', None, False, False),
                  (3, 0, 3, 'Alice', None, False, True)],
         edges=[(0, 1, 'W', 'center'), (1, 2, 'W', 'bot'), (2, 3, 'W', 'bot')],
         expected=['[wait] W of Bob vs TBD', '  \u2514 W of Dan vs TBD']),

    # ── D: One TBD → TBD vs TBD ──
    dict(name='D1: One TBD \u2192 TBD vs TBD, no bye',
         matches=[(0, 0, 2, None, None, False, False),
                  (1, 0, 1, 'Bob', None, False, False),
                  (2, 0, 3, 'Alice', None, False, True)],
         edges=[(0, 1, 'W', 'bot'), (1, 2, 'W', 'bot')],
         expected=['[wait] W of Bob vs TBD', '  \u2514 W of TBD vs TBD']),

    dict(name='D2: One TBD \u2192 TBD vs TBD, bye on blocker\u2192Alice',
         matches=[(0, 0, 2, None, None, False, False),
                  (1, 0, 1, 'Bob', None, False, False),
                  (2, 0, 99, None, None, True, False),
                  (3, 0, 3, 'Alice', None, False, True)],
         edges=[(0, 1, 'W', 'bot'), (1, 2, 'W', 'center'), (2, 3, 'W', 'bot')],
         expected=['[wait] W of Bob vs TBD', '  \u2514 W of TBD vs TBD']),

    # ── E: Two TBDs → resolve both ──
    dict(name='E1: Two TBDs \u2192 resolve both, no bye',
         matches=[(0, 0.55, 2, 'Dan', 'Eve', False, False),
                  (0, -0.55, 4, 'Frank', 'Grace', False, False),
                  (1, 0, 1, None, None, False, False),
                  (2, 0, 3, 'Alice', None, False, True)],
         edges=[(0, 2, 'W', 'top'), (1, 2, 'L', 'bot'), (2, 3, 'W', 'bot')],
         expected=['[wait] W of TBD vs TBD',
                   '  \u2514 W of Dan vs Eve',
                   '  \u2514 L of Frank vs Grace']),

    dict(name='E2: Two TBDs \u2192 resolve both, bye on blocker\u2192Alice',
         matches=[(0, 0.55, 2, 'Dan', 'Eve', False, False),
                  (0, -0.55, 4, 'Frank', 'Grace', False, False),
                  (1, 0, 1, None, None, False, False),
                  (2, 0, 99, None, None, True, False),
                  (3, 0, 3, 'Alice', None, False, True)],
         edges=[(0, 2, 'W', 'top'), (1, 2, 'L', 'bot'),
                (2, 3, 'W', 'center'), (3, 4, 'W', 'bot')],
         expected=['[wait] W of TBD vs TBD',
                   '  \u2514 W of Dan vs Eve',
                   '  \u2514 L of Frank vs Grace']),
]

# ── Render ──
fig, axes = plt.subplots(5, 2, figsize=(24, 30))
fig.patch.set_facecolor(BG)
fig.suptitle('Blocker Algorithm Test Cases \u2014 Bracket View',
             fontsize=18, fontweight='bold', color=TXT, y=0.995)

for col, hdr in enumerate(['Without Bye', 'With Bye']):
    fig.text(0.27 + col * 0.48, 0.97, hdr, ha='center', fontsize=14,
             fontweight='bold', color=AMBER)

for idx, case in enumerate(cases):
    row, col = divmod(idx, 2)
    ax = axes[row][col]
    ax.set_facecolor(BG)
    ax.axis('off')

    # Draw matches
    boxes = []
    for rnd, vpos, mid, p1, p2, bye, alice in case['matches']:
        box = draw_match(ax, rnd * RS, vpos * VS, mid, p1, p2,
                         is_bye=bye, is_alice=alice)
        boxes.append(box)

    # Draw connectors
    for si, di, lbl, slot in case['edges']:
        draw_conn(ax, boxes[si], boxes[di], lbl, slot)

    # Fit view
    pad_x, pad_y = 0.6, 0.6
    x_lo = min(b['left'] for b in boxes) - pad_x
    x_hi = max(b['right'] for b in boxes) + pad_x
    y_lo = min(b['bot'] for b in boxes) - 2.0
    y_hi = max(b['top'] for b in boxes) + 0.9
    ax.set_xlim(x_lo, x_hi)
    ax.set_ylim(y_lo, y_hi)
    ax.set_aspect('equal')

    # Title
    ax.text((x_lo + x_hi) / 2, y_hi - 0.1, case['name'],
            ha='center', va='top', fontsize=10, fontweight='bold', color=TXT)

    # Expected output
    ey = y_lo + 0.15
    ax.text(x_lo + 0.3, ey + len(case['expected']) * 0.32 + 0.3,
            'Expected:', ha='left', va='top', fontsize=7.5, color=DIM,
            fontstyle='italic')
    for i, line in enumerate(case['expected']):
        ax.text(x_lo + 0.3, ey + (len(case['expected']) - 1 - i) * 0.32,
                line, ha='left', va='top', fontsize=8.5, color=TXT,
                fontfamily='monospace')

# Legend
ly = 0.012
for lx, label, bg, bd in [
    (0.12, 'Unresolved Match', PANEL, BD),
    (0.35, 'BYE (skipped by followTo)', BYE_BG, BYE_BD),
    (0.66, "Alice's Pending Match", ALICE_BG, ALICE_BD),
]:
    fig.patches.append(Rectangle((lx - 0.012, ly - 0.003), 0.024, 0.01,
                                 fc=bg, ec=bd, lw=1.3, transform=fig.transFigure))
    fig.text(lx + 0.02, ly + 0.002, label, fontsize=9, color=TXT,
             va='center', transform=fig.transFigure)
fig.text(0.9, ly + 0.002, 'TBD = amber', fontsize=9, color=AMBER,
         va='center', transform=fig.transFigure)

plt.tight_layout(rect=[0, 0.025, 1, 0.965])
plt.savefig(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'test_brackets.png'), dpi=150,
            facecolor=BG, bbox_inches='tight')
print('Saved to test_brackets.png')
