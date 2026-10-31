import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

type RevenuePoint = { month: string; revenue: number };

export default function RevenueChart({
  data,
  formatMoney,
}: {
  data: RevenuePoint[];
  formatMoney: (value: unknown) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 4, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="revenueGradient" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#7863e9" stopOpacity={0.22} />
            <stop offset="95%" stopColor="#7863e9" stopOpacity={0.01} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke="#eff0f5" />
        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: "#9699a9", fontSize: 11 }} dy={12} />
        <YAxis
          axisLine={false}
          tickLine={false}
          tick={{ fill: "#9699a9", fontSize: 11 }}
          tickFormatter={(value: number) => value >= 1000 ? `$${value / 1000}k` : `$${value}`}
        />
        <Tooltip
          formatter={(value) => formatMoney(value)}
          contentStyle={{ borderRadius: 12, border: "1px solid #eeedf4", boxShadow: "0 8px 24px #2b254312" }}
        />
        <Area
          type="monotone"
          dataKey="revenue"
          stroke="#7863e9"
          strokeWidth={2.5}
          fill="url(#revenueGradient)"
          activeDot={{ r: 5, fill: "#7863e9", stroke: "white", strokeWidth: 3 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
