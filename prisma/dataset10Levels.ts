export interface TaskDatasetItem {
  task_id: number;
  type: string;
  url: string;
  commission: number;
  credit_points: number;
  is_prepaid: boolean;
  prepaid_value?: number;
}

export interface LevelDatasetItem {
  level: number;
  title: string;
  total_tasks: number;
  level_reward: number;
  total_credit_points: number;
  tasks: TaskDatasetItem[];
}

export function cleanUrl(rawUrl: string): string {
  const mdMatch = rawUrl.match(/\((https?:\/\/[^\s\)]+)\)/);
  if (mdMatch) return mdMatch[1].replace(/_+$/, '');
  const urlMatch = rawUrl.match(/https?:\/\/[^\s\)\]]+/);
  if (urlMatch) return urlMatch[0].replace(/_+$/, '');
  return rawUrl.trim().replace(/^[\[\]]+|[\[\]]+$/g, '').replace(/_+$/, '');
}

export const DATASET_10_LEVELS: LevelDatasetItem[] = [
  {
    "level": 1,
    "title": "Study",
    "total_tasks": 10,
    "level_reward": 0,
    "total_credit_points": 0,
    "tasks": [
      {
        "task_id": 1,
        "type": "Subscribe",
        "url": "https://youtu.be/vo4pMVb0R6M?si=I1idXSAT49o8qQlA",
        "commission": 15,
        "credit_points": 15,
        "is_prepaid": false
      },
      {
        "task_id": 2,
        "type": "Like and Comment",
        "url": "https://youtu.be/00jbG_cfGuQ?si=koLvGK8-Yk-1XBbv",
        "commission": 15,
        "credit_points": 15,
        "is_prepaid": false
      },
      {
        "task_id": 3,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/Yocja_N5s1I?si=9jvSeT6wfULOpTBX",
        "commission": 15,
        "credit_points": 15,
        "is_prepaid": false
      },
      {
        "task_id": 4,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/B3u4EFTwprM?si=Yklgf1smjHpY-rbh",
        "commission": 15,
        "credit_points": 15,
        "is_prepaid": false
      },
      {
        "task_id": 5,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/FrlJl2UXRU0?si=un0Uee3RG2nIciDe",
        "commission": 15,
        "credit_points": 15,
        "is_prepaid": false
      },
      {
        "task_id": 6,
        "type": "Subscribe",
        "url": "https://youtu.be/9t5NOKVUTZo?si=rD4k5-dQY4icij07",
        "commission": 15,
        "credit_points": 15,
        "is_prepaid": false
      },
      {
        "task_id": 7,
        "type": "Like and Comment",
        "url": "https://youtu.be/tZ7lsQV95yo?si=KGD7uqw1px-uC8Fb",
        "commission": 15,
        "credit_points": 15,
        "is_prepaid": false
      },
      {
        "task_id": 8,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/I6O_v-cYh20?si=g4enNZAw5GCqKWb",
        "commission": 15,
        "credit_points": 15,
        "is_prepaid": false
      },
      {
        "task_id": 9,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/_phJIm8mUT8?si=NYby4z78otMFxM9",
        "commission": 15,
        "credit_points": 15,
        "is_prepaid": false
      },
      {
        "task_id": 10,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/JSXlT_xvLko?si=su6ypDXlUoKtPUbT",
        "commission": 15,
        "credit_points": 15,
        "is_prepaid": false
      }
    ]
  },
  {
    "level": 2,
    "title": "Vlog",
    "total_tasks": 10,
    "level_reward": 0,
    "total_credit_points": 0,
    "tasks": [
      {
        "task_id": 1,
        "type": "Subscribe",
        "url": "https://youtu.be/nzciqaNN4I0?si=QcGDCUl8ABo9Qlwd",
        "commission": 30,
        "credit_points": 30,
        "is_prepaid": false
      },
      {
        "task_id": 2,
        "type": "Like and Comment",
        "url": "https://youtu.be/1iJE8Lyvvls?si=yP3qFuihCpIdC5UV",
        "commission": 30,
        "credit_points": 30,
        "is_prepaid": false
      },
      {
        "task_id": 3,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/wyBimQmMZMo?si=BM6sLmxsw3UiQetL",
        "commission": 30,
        "credit_points": 30,
        "is_prepaid": false
      },
      {
        "task_id": 4,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/798f3txy4Zs?si=NpAZSSjCHf5sXQHn",
        "commission": 30,
        "credit_points": 30,
        "is_prepaid": false
      },
      {
        "task_id": 5,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/M2iHz1cVKxc?si=AKicqraZOjPv3mgg",
        "commission": 30,
        "credit_points": 30,
        "is_prepaid": false
      },
      {
        "task_id": 6,
        "type": "Subscribe",
        "url": "https://youtu.be/3cZ_QsA-Q0Q?si=EVMDukq8QHPDKnep",
        "commission": 30,
        "credit_points": 30,
        "is_prepaid": false
      },
      {
        "task_id": 7,
        "type": "Like and Comment",
        "url": "https://youtu.be/HGX31br5XD4?si=i55C748M-mSi0lts",
        "commission": 30,
        "credit_points": 30,
        "is_prepaid": false
      },
      {
        "task_id": 8,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/pgn8wq-WRN8?si=EcwXdqRmVC9LynqC",
        "commission": 30,
        "credit_points": 30,
        "is_prepaid": false
      },
      {
        "task_id": 9,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/UlvuMvKkg5U?si=O35IJAiVVAKTmttz",
        "commission": 30,
        "credit_points": 30,
        "is_prepaid": false
      },
      {
        "task_id": 10,
        "type": "Prepaid VIP Task #10",
        "url": "https://youtu.be/K8Y2V9AwOos?si=SxysGiMzNJ9Eg2id",
        "commission": 264,
        "credit_points": 264,
        "is_prepaid": true,
        "prepaid_value": 1320
      }
    ]
  },
  {
    "level": 3,
    "title": "Vlog",
    "total_tasks": 10,
    "level_reward": 0,
    "total_credit_points": 0,
    "tasks": [
      {
        "task_id": 1,
        "type": "Subscribe",
        "url": "https://youtu.be/7vOkn4m-XCs?si=t75KaK78GG1D87ev",
        "commission": 50,
        "credit_points": 50,
        "is_prepaid": false
      },
      {
        "task_id": 2,
        "type": "Like and Comment",
        "url": "https://youtu.be/96GXqWaQcEE?si=QGeuAtrOng32KBf2",
        "commission": 50,
        "credit_points": 50,
        "is_prepaid": false
      },
      {
        "task_id": 3,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/CZvYvUGLNMg?si=CAdnkQ9DrlGLeNji",
        "commission": 50,
        "credit_points": 50,
        "is_prepaid": false
      },
      {
        "task_id": 4,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/APe0TO49E00?si=uzr2jUeVwfwiCEpC",
        "commission": 50,
        "credit_points": 50,
        "is_prepaid": false
      },
      {
        "task_id": 5,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/hbHILEt52VI?si=M-5ga8nGEDax316y",
        "commission": 50,
        "credit_points": 50,
        "is_prepaid": false
      },
      {
        "task_id": 6,
        "type": "Subscribe",
        "url": "https://youtu.be/WkQrMzwqKv4?si=_eQzhwDMoiCrsDUi",
        "commission": 50,
        "credit_points": 50,
        "is_prepaid": false
      },
      {
        "task_id": 7,
        "type": "Like and Comment",
        "url": "https://youtu.be/CQpxJhN16pM?si=Huj0tEOmziuHzY-A",
        "commission": 50,
        "credit_points": 50,
        "is_prepaid": false
      },
      {
        "task_id": 8,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/CBhRIsc_14A?si=taf3RX_E_M3_wgXs",
        "commission": 50,
        "credit_points": 50,
        "is_prepaid": false
      },
      {
        "task_id": 9,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/F7sPLM-ThnA?si=GozFZ1wHIl4HPnSL",
        "commission": 50,
        "credit_points": 50,
        "is_prepaid": false
      },
      {
        "task_id": 10,
        "type": "Prepaid VIP Task #10",
        "url": "https://youtu.be/8T0m8f44Kgs?si=XPXvxc3B5IOOXrP-",
        "commission": 1337,
        "credit_points": 1337,
        "is_prepaid": true,
        "prepaid_value": 6686
      }
    ]
  },
  {
    "level": 4,
    "title": "Vlog",
    "total_tasks": 10,
    "level_reward": 0,
    "total_credit_points": 0,
    "tasks": [
      {
        "task_id": 1,
        "type": "Prepaid VIP Task #1",
        "url": "https://youtu.be/ew__gmVo3Nk?si=cFdkl1FDuMSy2749",
        "commission": 6990,
        "credit_points": 6990,
        "is_prepaid": true,
        "prepaid_value": 17476
      },
      {
        "task_id": 2,
        "type": "Prepaid VIP Task #2",
        "url": "https://youtu.be/YCzRPKRAWmw?si=OKAr0OUB0T9XBzhJ",
        "commission": 10990,
        "credit_points": 10990,
        "is_prepaid": true,
        "prepaid_value": 27476
      },
      {
        "task_id": 3,
        "type": "Prepaid VIP Task #3",
        "url": "https://youtu.be/irHIeMEP5hw?si=Fh8SSfl0koXUrYrk",
        "commission": 14990,
        "credit_points": 14990,
        "is_prepaid": true,
        "prepaid_value": 37476
      },
      {
        "task_id": 4,
        "type": "Prepaid VIP Task #4",
        "url": "https://youtu.be/45GUatkxX3s?si=ZjsYNezm1YpflOOJ",
        "commission": 22990,
        "credit_points": 22990,
        "is_prepaid": true,
        "prepaid_value": 57476
      },
      {
        "task_id": 5,
        "type": "Prepaid VIP Task #5",
        "url": "https://youtu.be/_PB8D_W6CK8?si=LpdY4Z4-d5CwjcKe",
        "commission": 32990,
        "credit_points": 32990,
        "is_prepaid": true,
        "prepaid_value": 82476
      },
      {
        "task_id": 6,
        "type": "Prepaid VIP Task #6",
        "url": "https://youtu.be/ZnmU_6BD0pY?si=XlE3zCfn8ufLolJ8",
        "commission": 36990,
        "credit_points": 36990,
        "is_prepaid": true,
        "prepaid_value": 92476
      },
      {
        "task_id": 7,
        "type": "Prepaid VIP Task #7",
        "url": "https://youtu.be/jCPcZUifbkc?si=W8SFeXKJEnh6h_BT",
        "commission": 40990,
        "credit_points": 40990,
        "is_prepaid": true,
        "prepaid_value": 102476
      },
      {
        "task_id": 8,
        "type": "Prepaid VIP Task #8",
        "url": "https://youtu.be/EYeG5TiE2B0?si=IdoR0rcI430rFiXP",
        "commission": 44990,
        "credit_points": 44990,
        "is_prepaid": true,
        "prepaid_value": 112476
      },
      {
        "task_id": 9,
        "type": "Prepaid VIP Task #9",
        "url": "https://youtu.be/veNdcvpCNRM?si=LTwSsN-0YCpuY4he",
        "commission": 64990,
        "credit_points": 64990,
        "is_prepaid": true,
        "prepaid_value": 162476
      },
      {
        "task_id": 10,
        "type": "Prepaid VIP Task #10",
        "url": "https://youtu.be/bA1j3q0Q5wo?si=IpB8KdfE9f7NA-_A",
        "commission": 84990,
        "credit_points": 84990,
        "is_prepaid": true,
        "prepaid_value": 212476
      }
    ]
  },
  {
    "level": 5,
    "title": "Level 5",
    "total_tasks": 10,
    "level_reward": 0,
    "total_credit_points": 0,
    "tasks": [
      {
        "task_id": 1,
        "type": "Subscribe",
        "url": "https://youtu.be/bmyXHQQctyQ?si=WE3n94_t2VjUipve",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 2,
        "type": "Like and Comment",
        "url": "https://youtu.be/XgnSxvUiXO0?si=22ktWXjGWh1OOnwt",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 3,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/pmjH9erWu48?si=ZPVv0sGjxwpdQ2JW",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 4,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/HOWaPR9brOE?si=q508JZyHn6ROxrB0",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 5,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/yqH3DcxB6Dk?si=kjp1orUfY-WKbbJS",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 6,
        "type": "Subscribe",
        "url": "https://youtu.be/31HJbpU2RpU?si=y--XuUEVnQumEdqj",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 7,
        "type": "Like and Comment",
        "url": "https://youtu.be/GwifegtMmUI?si=eP2xJ1bdsoVzTyzY",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 8,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/6Ct2D12cHqw?si=_hE-crwndkoC1pBS",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 9,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/-6kARhVxEWA?si=dB6y1GiHnaEJBRkC",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 10,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/yIjjg5_5Cxw?si=jD2O34ChfbY65zqA",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      }
    ]
  },
  {
    "level": 6,
    "title": "Level 6",
    "total_tasks": 10,
    "level_reward": 0,
    "total_credit_points": 0,
    "tasks": [
      {
        "task_id": 1,
        "type": "Subscribe",
        "url": "https://youtu.be/qgz-ydhRs4s?si=Il542hKwwSHMMFT3",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 2,
        "type": "Like and Comment",
        "url": "https://youtu.be/XaEkHoMtc5Q?si=h0RzVrtAK9jQBRcg",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 3,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/3nYntR_BmD0?si=OqMoHNGPDd8x4853",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 4,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/8BOnFKojVYc?si=59knG1PQVKYd6gVk",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 5,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/B3j7o3RfBVI?si=nSo3Ii77SdDR4iI4",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 6,
        "type": "Subscribe",
        "url": "https://youtu.be/TYWrS9lbHVo?si=vylP_TFVidoIjhWL",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 7,
        "type": "Like and Comment",
        "url": "https://youtu.be/Jjpfl2hgN5k?si=XhKzdxX-i616kqTs",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 8,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/t1y9vFl3LQc?si=H-TnYfPxFjrPx91H",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 9,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/esY3mHyDFi4?si=3hxcM_soqfG8GTro",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 10,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/1lCZKskfCqI?si=GiRq7gaiCzepy0ka",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      }
    ]
  },
  {
    "level": 7,
    "title": "Level 7",
    "total_tasks": 10,
    "level_reward": 0,
    "total_credit_points": 0,
    "tasks": [
      {
        "task_id": 1,
        "type": "Subscribe",
        "url": "https://youtu.be/B9WFwGvMUZg?si=0iEB2lrtL56J4cmx",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 2,
        "type": "Like and Comment",
        "url": "https://youtu.be/YqedmavuG64?si=prGU4MJUaaDCnoBI",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 3,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/bA33aA83DUs?si=oOEtJwbWRdtsXZIe",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 4,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/l0EC6dvS89M?si=WlG698OLMa_adZkK",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 5,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/SJYdo3ScJDM?si=rofNESmY3HHZDE9d",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 6,
        "type": "Subscribe",
        "url": "https://youtu.be/nsV-B79x33I?si=aLI7nHiMwgl0yG1i",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 7,
        "type": "Like and Comment",
        "url": "https://youtu.be/fCDVn0Ri2dU?si=MmFVxtjmJalzqsSQ",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 8,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/4z1OyqDyR2E?si=C0Qc5ZF84_vS-EtS",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 9,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/sSFYNRoo4r4?si=6hWH6qxt9ylI7pWi",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 10,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/Wr5X3lJ30R4?si=KHX-cBl50XRgR3D1",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      }
    ]
  },
  {
    "level": 8,
    "title": "Level 8",
    "total_tasks": 10,
    "level_reward": 0,
    "total_credit_points": 0,
    "tasks": [
      {
        "task_id": 1,
        "type": "Subscribe",
        "url": "https://youtu.be/OS-WTughD14?si=xyiP5FPupBzSfQ9p",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 2,
        "type": "Like and Comment",
        "url": "https://youtu.be/d4M3YRLiSwM?si=D0a3oKwRCFUdkJ5B",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 3,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/nGNlcnGobAY?si=nK83aH5a-W8ph9Xv",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 4,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/hTkjqhOsgwc?si=QGKy8vK_l7vLut11",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 5,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/AGUb2Nn7pKQ?si=-3czbIuznEgR0tew",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 6,
        "type": "Subscribe",
        "url": "https://youtu.be/h76Q3E_9aNw?si=l3FGEQYqwFooHtvF",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 7,
        "type": "Like and Comment",
        "url": "https://youtu.be/m7pxtU5qz2U?si=QoDpPdbZNjePMXMb",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 8,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/7bGRQJzAKZw?si=uwF3CcleRr4o30up",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 9,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/5Z-qAutLgHA?si=GyPFMacS3gxvVogE",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 10,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/0TCQClBCJA8?si=S9dn0asC5H9fRU8p",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      }
    ]
  },
  {
    "level": 9,
    "title": "Level 9",
    "total_tasks": 10,
    "level_reward": 0,
    "total_credit_points": 0,
    "tasks": [
      {
        "task_id": 1,
        "type": "Subscribe",
        "url": "https://youtu.be/AnYl6Nk9GOA?si=uJMUmAkCoFVqzSZ2",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 2,
        "type": "Like and Comment",
        "url": "https://youtu.be/UItWltVZZmE?si=4fMmgvmTZhm9xq9s",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 3,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/Cw-Wt4xKD2s?si=HCCHU3lcQEGIOpAV",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 4,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/jC5xlKIQgR8?si=SM5t6XKxplYQIXlP",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 5,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/X8FNAzCoCoI?si=VLs5Ol5Gh2StDnzK",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 6,
        "type": "Subscribe",
        "url": "https://youtu.be/fsJ14Bra8Io?si=Q2E7TZ-Gi0s6Eu7A",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 7,
        "type": "Like and Comment",
        "url": "https://youtu.be/4tQrUif5pHY?si=qkw8NRq_gj0mmJMW",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 8,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/Nw5rO-fmL0A?si=JzoRZ80tEG6itSRk",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 9,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/EtjXNMS3eeU?si=kxWkl392jatI2qT6",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 10,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/UV63-EXSFI8?si=amwqxlSS2QF08epH",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      }
    ]
  },
  {
    "level": 10,
    "title": "Level 10",
    "total_tasks": 10,
    "level_reward": 0,
    "total_credit_points": 0,
    "tasks": [
      {
        "task_id": 1,
        "type": "Subscribe",
        "url": "https://youtu.be/Z22mFwbCrCA?si=9Yjc9AH0eRZ4FNxb",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 2,
        "type": "Like and Comment",
        "url": "https://youtu.be/PGpb6Zc4KkE?si=hd0i40qWqeRPca4L",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 3,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/YHccUdhUE_Y?si=u-PDsW3JgEdo5llT",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 4,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/RVpKbiTvLWY?si=BpMN-6bpskK0ORfp",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 5,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/AJtkuFN1apc?si=ampDjQmn6PkH5PWs",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 6,
        "type": "Subscribe",
        "url": "https://youtu.be/k8eR5sBUCPw?si=tMuw34hpQu6CC5Fe",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 7,
        "type": "Like and Comment",
        "url": "https://youtu.be/LSKRceF5ykE?si=EJkkg6RzukZppH0y",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 8,
        "type": "Watch Video (30s)",
        "url": "https://youtu.be/KPIC2P_jFfU?si=6Lcs9aV9QdjMDAGO",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 9,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/qOWVl6j87nI?si=rMV76Ws1W3PnzqpC",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      },
      {
        "task_id": 10,
        "type": "Watch Video (45s)",
        "url": "https://youtu.be/UrjimhELcok?si=WRKmKc2Gcyje6pTV",
        "commission": 0,
        "credit_points": 0,
        "is_prepaid": false,
        "prepaid_value": 0
      }
    ]
  }
];
