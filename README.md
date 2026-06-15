# Maritime Route Optimizer

远洋货轮航线规划与气象避碰全栈系统。

## 项目结构

```
maritime-route-optimizer/
├── backend/                 # 后端服务 (Node.js + Express)
│   ├── src/
│   │   ├── grib2/          # GRIB2气象数据解析
│   │   ├── s57/            # S-57电子海图解析
│   │   ├── pathfinding/    # A*路径规划算法
│   │   └── server.js       # Express + WebSocket服务器
│   ├── tests/              # 测试文件
│   └── package.json
├── frontend/               # 前端应用 (React + Mapbox GL)
│   ├── src/
│   │   ├── components/     # React组件
│   │   ├── services/       # API服务
│   │   ├── styles/         # 样式文件
│   │   ├── config.js       # 配置文件
│   │   └── App.js          # 主应用组件
│   ├── public/
│   └── package.json
└── README.md
```

## 功能特性

### 气象解析层 (后端)
- ✅ GRIB2气象数据纯二进制解析（不依赖外部解码库）
- ✅ 全球网格化高空风场数据提取（u/v分量）
- ✅ 洋流数据解析
- ✅ 海浪高度数据解析
- ✅ ECDIS标准S-57电子海图解析
- ✅ 水深数据提取
- ✅ 航道禁区识别

### 路径规划层 (后端)
- ✅ 改进型A*寻路算法
- ✅ 气象权重优化（风场、洋流、海浪）
- ✅ 燃油经济性最优计算
- ✅ 水深限制检查
- ✅ 禁区避碰
- ✅ 实时航行估算（时间、距离、油耗）

### 前端渲染层
- ✅ React + Mapbox GL JS地图
- ✅ WebGL风场流体粒子动画
- ✅ 航线高亮显示
- ✅ 航点数据可视化
- ✅ WebSocket实时数据推送
- ✅ 海浪热力图
- ✅ 港口标记
- ✅ 禁区显示

## 快速开始

### 后端启动

```bash
cd backend
npm install
npm start
```

后端服务运行在 `http://localhost:3001`

### 前端启动

```bash
cd frontend
npm install
npm start
```

前端应用运行在 `http://localhost:3000`

## API接口

### HTTP API

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/health` | GET | 服务健康检查 |
| `/api/weather` | GET | 获取气象网格数据 |
| `/api/weather/wind` | GET | 获取风场数据 |
| `/api/weather/waves` | GET | 获取海浪数据 |
| `/api/chart` | GET | 获取海图数据 |
| `/api/ports` | GET | 获取港口列表 |
| `/api/route/plan` | POST | 规划航线 |
| `/api/route/:id` | GET | 获取航线详情 |
| `/api/route/:id/waypoints` | GET | 获取航线航点 |

### WebSocket API

连接: `ws://localhost:3001`

消息类型:
- `subscribe_weather` - 订阅气象数据
- `subscribe_route` - 订阅航线进度
- `plan_route` - 规划航线（流式返回）

## 技术栈

### 后端
- Node.js 18+
- Express 4.x
- WebSocket (ws)
- 纯二进制GRIB2解析（无外部依赖）

### 前端
- React 18
- Mapbox GL JS 2.x
- WebGL（自定义风场粒子渲染）
- React Scripts (Create React App)

## 算法说明

### A*路径优化
- 启发函数：Haversine大圆距离
- 移动代价：考虑风速、风向、浪高的综合权重
- 障碍检测：水深不足、禁航区域、海浪过高
- 松弛模式：当严格模式找不到路径时，允许穿越低优先级障碍

### 燃油消耗模型
- 基础油耗：与航速三次方成正比
- 气象影响：逆风/逆流增加油耗，顺风/顺流减少油耗
- 海浪影响：大浪增加船舶阻力

## 注意事项

1. **Mapbox Token**: 前端需要有效的Mapbox访问令牌，请在 `frontend/src/config.js` 中配置
2. **数据演示**: 当前使用模拟气象和海图数据，生产环境需接入真实数据源
3. **性能**: 网格数据已针对前端显示进行压缩，原始数据分辨率更高

## License

MIT
