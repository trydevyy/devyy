// Copyright (C) 2026 Devyy contributors
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import * as Primitive from "@radix-ui/react-select";
import {
  Children,
  Fragment,
  isValidElement,
  useState,
  type ChangeEvent,
  type ComponentProps,
  type SelectHTMLAttributes,
  type ReactNode,
} from "react";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

type Props = Omit<SelectHTMLAttributes<HTMLSelectElement>, "multiple" | "size"> & {
  onOpenChange?: (open: boolean) => void;
  popup?: Pick<ComponentProps<typeof Primitive.Content>, "align" | "side" | "sideOffset" | "className">;
};
type Item = {
  value: string;
  label: ReactNode;
  disabled?: boolean;
  group?: string;
};
export default function Select({
  value,
  defaultValue,
  onChange,
  onOpenChange,
  popup,
  children,
  className,
  disabled,
  id,
  name,
  ...attributes
}: Props) {
  const [local, setLocal] = useState(String(defaultValue ?? ""));
  const [dialog, setDialog] = useState<HTMLDialogElement>();
  const items: Item[] = [];
  function collect(nodes: ReactNode, group?: string) {
    Children.forEach(nodes, (node) => {
      if (
        !isValidElement<{
          value?: string | number;
          children?: ReactNode;
          disabled?: boolean;
          label?: string;
        }>(node)
      )
        return;
      if (node.type === "option")
        items.push({
          value: String(node.props.value ?? ""),
          label: node.props.children,
          disabled: node.props.disabled,
          group,
        });
      else
        collect(
          node.props.children,
          node.type === "optgroup" ? node.props.label : group,
        );
    });
  }
  collect(children);
  let empty = "__devyy_empty_option__";
  while (items.some((item) => item.value === empty)) empty += "_";
  const current = value === undefined ? local : String(value);
  return (
    <Primitive.Root
      value={current || empty}
      disabled={disabled}
      name={name}
      onOpenChange={onOpenChange}
      onValueChange={(next) => {
        const selected = next === empty ? "" : next;
        setLocal(selected);
        onChange?.({
          target: { value: selected },
          currentTarget: { value: selected },
        } as ChangeEvent<HTMLSelectElement>);
      }}
    >
      <Primitive.Trigger
        ref={(node) => { if (node) setDialog(node.closest("dialog") ?? undefined); }}
        {...(attributes as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        id={id}
        className={`devyy-select ${className ?? ""}`}
        data-value={current}
      >
        <Primitive.Value>
          {items.find((item) => item.value === current)?.label ?? current}
        </Primitive.Value>
        <Primitive.Icon>
          <ChevronDown size={13} />
        </Primitive.Icon>
      </Primitive.Trigger>
      <Primitive.Portal container={dialog}>
        <Primitive.Content
          className={`devyy-select-popup ${popup?.className ?? ""}`}
          position="popper"
          align={popup?.align}
          side={popup?.side}
          sideOffset={popup?.sideOffset ?? 5}
          collisionPadding={10}
          data-escape-scope="active"
        >
          <Primitive.ScrollUpButton className="devyy-select-scroll">
            <ChevronUp size={12} />
          </Primitive.ScrollUpButton>
          <Primitive.Viewport>
            {items.map((item, index) => (
              <Fragment key={`${item.value}-${index}`}>
                {item.group && items[index - 1]?.group !== item.group && (
                  <div className="devyy-select-group">{item.group}</div>
                )}
                <Primitive.Item
                  className="devyy-select-option"
                  value={item.value || empty}
                  disabled={item.disabled}
                  data-value={item.value}
                >
                  <Primitive.ItemText>{item.label}</Primitive.ItemText>
                  <Primitive.ItemIndicator>
                    <Check size={13} />
                  </Primitive.ItemIndicator>
                </Primitive.Item>
              </Fragment>
            ))}
          </Primitive.Viewport>
          <Primitive.ScrollDownButton className="devyy-select-scroll">
            <ChevronDown size={12} />
          </Primitive.ScrollDownButton>
        </Primitive.Content>
      </Primitive.Portal>
    </Primitive.Root>
  );
}
