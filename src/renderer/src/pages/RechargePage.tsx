import { Button, Card } from "@heroui/react";

const rechargePlans = [
  { minutes: 60, price: 19, label: "体验包" },
  { minutes: 300, price: 79, label: "推荐" },
  { minutes: 900, price: 199, label: "畅享包" },
];

export function RechargePage() {
  return (
    <div className="mx-auto max-w-5xl px-10 py-8">
      <p className="mb-2 text-sm font-medium text-muted">账户与时长</p>
      <h2 className="text-3xl font-semibold tracking-tight">时长充值</h2>
      <p className="mt-3 text-sm text-muted">
        选择适合你的面试时长包，支付接口当前使用 Mock 数据。
      </p>
      <div className="mt-10 grid grid-cols-3 gap-5">
        {rechargePlans.map((plan, index) => (
          <Card
            className={`border bg-white p-6 shadow-sm ${
              index === 1 ? "border-black" : "border-black/6"
            }`}
            key={plan.minutes}
          >
            <span className="w-fit rounded-full bg-[#f2f2f2] px-3 py-1 text-xs font-medium">
              {plan.label}
            </span>
            <Card.Header className="mt-5">
              <Card.Title className="text-3xl">{plan.minutes} 分钟</Card.Title>
              <Card.Description>购买后立即到账，永久有效</Card.Description>
            </Card.Header>
            <div className="mt-8 flex items-end justify-between">
              <p>
                <span className="text-sm">¥</span>
                <span className="text-3xl font-semibold">{plan.price}</span>
              </p>
              <Button
                className={index === 1 ? "bg-black text-white" : ""}
                variant={index === 1 ? "primary" : "outline"}
              >
                立即充值
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
