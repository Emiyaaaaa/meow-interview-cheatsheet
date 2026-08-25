import { Button, Card, Chip, Description, Label } from "@heroui/react";
import { Sparkles } from "lucide-react";

const rechargePlans: {
  minutes: number;
  regular: number;
  price: number;
  title: string;
}[] = [
  { minutes: 60, regular: 10, price: 0, title: "1小时体验卡" },
  { minutes: 60, regular: 10, price: 6.6, title: "1小时卡" },
  { minutes: 60 * 3, regular: 10 * 3, price: 16.6, title: "3小时卡" },
  { minutes: 60 * 5, regular: 10 * 5, price: 25, title: "5小时卡" },
  { minutes: 60 * 8, regular: 10 * 8, price: 36.6, title: "8小时卡" },
];

/** 原价保留 1 位小数；折扣 = price/regular，向下取整到 2 位小数后换算为「折」。整十（如 50）显示为 5 折。 */
function formatDiscountLabel(price: number, regular: number): string {
  const regularFixed = Number(regular.toFixed(1));
  if (regularFixed <= 0) return "";
  if (price <= 0) return "免费";
  const ratio = Math.floor((price / regularFixed) * 100) / 100;
  const zhe = Math.floor(ratio * 100);
  return `${zhe % 10 === 0 ? zhe / 10 : zhe}折`;
}

export function RechargePage() {
  return (
    <div className="mx-auto max-w-5xl px-10 py-8">
      <h2 className="text-3xl font-semibold tracking-tight">时长充值</h2>
      <div className="mt-10 grid grid-cols-2 gap-5 lg:grid-cols-3">
        {rechargePlans.map((plan, index) => {
          const discountLabel = formatDiscountLabel(plan.price, plan.regular);

          return (
            <Card
              className="rounded-lg border p-4 border-black/6 hover:border-black/30"
              key={`${plan.title}-${plan.minutes}`}
            >
              {discountLabel ? (
                <Chip
                  size="sm"
                  variant="soft"
                  color="success"
                  className="absolute right-1.5 top-1.5 rounded-sm px-2.5"
                >
                  <Sparkles className="size-3" />
                  <Chip.Label>{discountLabel}</Chip.Label>
                </Chip>
              ) : null}
              <div className="flex flex-col gap-1">
                <Label className="text-lg font-semibold">{plan.title}</Label>
                <Description>{`获得${plan.minutes}分钟面试时长`}</Description>
              </div>
              <div className="mt-8 flex items-end justify-between">
                <div className="flex items-baseline gap-2">
                  <p>
                    <span className="text-sm">¥</span>
                    <span className="text-3xl font-semibold">
                      {plan.price === 0 ? "0" : plan.price}
                    </span>
                  </p>
                  <span className="text-sm text-muted line-through">
                    ¥{plan.regular}
                  </span>
                </div>
                <Button
                  className={index === 1 ? "bg-black text-white" : ""}
                  variant={index === 1 ? "primary" : "outline"}
                >
                  开通
                </Button>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
