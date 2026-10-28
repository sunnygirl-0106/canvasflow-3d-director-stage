import test from 'node:test';
import assert from 'node:assert/strict';
import * as moves from '../src/anim/cameraMoves.js';

// Captured from archive/before-slim-v3-phase2 before changing the catalog.
const expected = {
  "CAMERA_MOVES": [
    [
      "push_in",
      "推"
    ],
    [
      "pull_out",
      "拉"
    ],
    [
      "truck",
      "横移"
    ],
    [
      "crane",
      "升降"
    ],
    [
      "pan",
      "摇"
    ],
    [
      "half_orbit",
      "半环绕"
    ],
    [
      "circle",
      "环绕"
    ]
  ],
  "MOVE_LABEL": {
    "push_in": "推",
    "pull_out": "拉",
    "truck": "横移",
    "crane": "升降",
    "pan": "摇",
    "half_orbit": "半环绕",
    "circle": "环绕"
  },
  "MOVE_DURATION": {
    "push_in": 3,
    "pull_out": 3,
    "truck": 3,
    "crane": 3,
    "pan": 2,
    "half_orbit": 5,
    "circle": 8
  },
  "MOVE_PARAMS": {
    "push_in": [
      "amount"
    ],
    "pull_out": [
      "amount"
    ],
    "truck": [
      "amount",
      "dir"
    ],
    "crane": [
      "amount",
      "dir"
    ],
    "pan": [],
    "half_orbit": [
      "sweep",
      "dir"
    ],
    "circle": [
      "sweep",
      "dir"
    ]
  },
  "PANEL_LABEL": {
    "push_in": "推近",
    "pull_out": "拉远",
    "truck": "横移",
    "crane": "升降",
    "pan": "摇镜头",
    "half_orbit": "半弧",
    "circle": "环绕",
    "spiral": "螺旋上升"
  },
  "PANEL_MOVES": [
    "circle",
    "half_orbit",
    "push_in",
    "pull_out",
    "crane",
    "truck",
    "spiral"
  ],
  "PANEL_DURATION": {
    "circle": 2,
    "half_orbit": 2,
    "push_in": 2,
    "pull_out": 2,
    "crane": 2,
    "truck": 2,
    "spiral": 2,
    "pan": 2
  },
  "PANEL_PARAMS": {
    "push_in": [
      "amount"
    ],
    "pull_out": [
      "amount"
    ],
    "truck": [
      "amount",
      "dir"
    ],
    "crane": [
      "amount",
      "dir"
    ],
    "pan": [],
    "half_orbit": [
      "sweep",
      "dir"
    ],
    "circle": [
      "sweep",
      "dir"
    ],
    "spiral": [
      "sweep",
      "rise",
      "dir"
    ]
  },
  "MOVE_DIRS": {
    "truck": [
      [
        "left",
        "向左"
      ],
      [
        "right",
        "向右"
      ]
    ],
    "crane": [
      [
        "up",
        "升"
      ],
      [
        "down",
        "降"
      ]
    ],
    "half_orbit": [
      [
        "ccw",
        "逆时针"
      ],
      [
        "cw",
        "顺时针"
      ]
    ],
    "circle": [
      [
        "ccw",
        "逆时针"
      ],
      [
        "cw",
        "顺时针"
      ]
    ],
    "spiral": [
      [
        "ccw",
        "逆时针"
      ],
      [
        "cw",
        "顺时针"
      ]
    ]
  }
};

test('运镜统一词表与基线的全部导出值和顺序逐项一致', () => {
  for (const [name, value] of Object.entries(expected)) {
    assert.deepEqual(moves[name], value, name);
    assert.deepEqual(Object.keys(moves[name]), Object.keys(value), name + ' key order');
  }
});
