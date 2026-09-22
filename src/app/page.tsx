import { HomeLauncher } from "@/components/home/home-launcher";

/**
 * Стартовый экран собирается при сборке: читать на каждом запросе больше
 * нечего. `force-dynamic` стоял здесь ради адреса фонового видео из
 * окружения, а видео заменила жидкая сцена.
 */
export default function Home() {
  return <HomeLauncher />;
}
