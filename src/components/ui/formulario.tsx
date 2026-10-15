"use client";

import * as React from "react";
import {
  Select as SelectPrimitive,
  Checkbox as CheckboxPrimitive,
  Switch as SwitchPrimitive,
  Tabs as TabsPrimitive,
  RadioGroup as RadioGroupPrimitive,
} from "radix-ui";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/* ---------------------------------------------------------- Select */
export interface OpcaoSelect {
  valor: string;
  rotulo: string;
  desabilitada?: boolean;
}

interface SelectProps {
  valor?: string;
  aoMudar: (valor: string) => void;
  opcoes: OpcaoSelect[];
  placeholder?: string;
  id?: string;
  className?: string;
  desabilitado?: boolean;
  "aria-label"?: string;
}

/** Valor vazio não é permitido pelo Radix; usamos um sentinela para "nenhum". */
const VAZIO = "__vazio__";

export function Select({ valor, aoMudar, opcoes, placeholder = "Selecione", id, className, desabilitado, ...aria }: SelectProps) {
  return (
    <SelectPrimitive.Root
      value={valor === "" || valor === undefined ? undefined : valor}
      onValueChange={(v) => aoMudar(v === VAZIO ? "" : v)}
      disabled={desabilitado}
    >
      <SelectPrimitive.Trigger
        id={id}
        aria-label={aria["aria-label"]}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border bg-card px-3 py-2 text-sm shadow-xs data-[placeholder]:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring [&>span]:truncate",
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown className="size-4 opacity-60" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={4} className="z-50 max-h-80 min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border bg-popover text-popover-foreground shadow-md">
          <SelectPrimitive.Viewport className="p-1">
            {opcoes.map((o) => (
              <SelectPrimitive.Item
                key={o.valor || VAZIO}
                value={o.valor || VAZIO}
                disabled={o.desabilitada}
                className="relative flex w-full cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-none select-none focus:bg-accent data-[disabled]:opacity-50"
              >
                <SelectPrimitive.ItemText>{o.rotulo}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-2 flex items-center">
                  <Check className="size-4" />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

/* -------------------------------------------------------- Checkbox */
export function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        "peer size-4 shrink-0 rounded-[4px] border shadow-xs data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center">
        <Check className="size-3.5" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

/* ---------------------------------------------------------- Switch */
export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent shadow-xs transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-input disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="pointer-events-none block size-4 rounded-full bg-background shadow transition-transform data-[state=checked]:translate-x-4 data-[state=unchecked]:translate-x-0" />
    </SwitchPrimitive.Root>
  );
}

/* ------------------------------------------------------------ Tabs */
export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("inline-flex h-9 items-center gap-1 rounded-lg bg-muted p-1 text-muted-foreground", className)} {...props} />;
}
export function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-all data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-sm disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
      {...props}
    />
  );
}
export function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("mt-4 outline-none", className)} {...props} />;
}

/* ------------------------------------------------------ RadioGroup */
export const RadioGroup = RadioGroupPrimitive.Root;
export const RadioItem = RadioGroupPrimitive.Item;
export const RadioIndicator = RadioGroupPrimitive.Indicator;

/* ---------------------------------------------------------- Campo */
export function Campo({ rotulo, htmlFor, erro, ajuda, children, className }: {
  rotulo: string;
  htmlFor?: string;
  erro?: string;
  ajuda?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {rotulo}
      </label>
      {children}
      {ajuda && !erro && <p className="text-xs text-muted-foreground">{ajuda}</p>}
      {erro && (
        <p className="text-xs text-destructive" role="alert">
          {erro}
        </p>
      )}
    </div>
  );
}
