// Chart.js registration — import for side effects only
import {
  Chart,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  BarElement,
  BarController,
  LineController,
  DoughnutController,
  ScatterController,
  Filler,
  Tooltip,
  Legend,
} from 'chart.js';
import annotationPlugin from 'chartjs-plugin-annotation';

Chart.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  ArcElement,
  BarElement,
  BarController,
  LineController,
  DoughnutController,
  ScatterController,
  Filler,
  Tooltip,
  Legend,
  annotationPlugin
);
