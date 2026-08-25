import { useEffect, useState, type FormEvent } from "react";
import { Button, Description, Input, Label, TextField } from "@heroui/react";
import { DEFAULT_APP_NAME } from "../appName";

type SettingsPageProps = {
  appName: string;
  onAppNameChange: (name: string) => void;
};

export function SettingsPage({ appName, onAppNameChange }: SettingsPageProps) {
  const [inputValue, setInputValue] = useState(appName);

  useEffect(() => {
    setInputValue(appName);
  }, [appName]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onAppNameChange(inputValue);
  }

  return (
    <div className="mx-auto max-w-3xl px-10 py-8">
      <h2 className="text-3xl font-semibold tracking-tight">设置</h2>
      <form
        className="mt-10 rounded-2xl border border-black/6 bg-white p-6 shadow-sm"
        onSubmit={handleSubmit}
      >
        <TextField name="appName">
          <Label>应用名称</Label>
          <div className="flex items-center gap-2">
            <Input
              fullWidth
              maxLength={32}
              placeholder={DEFAULT_APP_NAME}
              value={inputValue}
              onChange={(event) => setInputValue(event.currentTarget.value)}
            />
            <Button
              className="bg-black text-white"
              isDisabled={inputValue.trim() === appName}
              type="submit"
            >
              保存
            </Button>
          </div>
          <Description>可修改为为「面试录音工具」，更加隐蔽。</Description>
        </TextField>
      </form>
    </div>
  );
}
