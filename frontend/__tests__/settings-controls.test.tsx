import { describe, it, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { ComingSoon, SegmentedControl, SettingRow, SettingsCard, Toggle } from "@/components/settings/controls";

describe("Toggle", () => {
  it("is an accessible switch that reports its state", () => {
    render(<Toggle checked={false} onChange={() => {}} label="Autoplay" />);
    const sw = screen.getByRole("switch", { name: "Autoplay" });
    expect(sw).toHaveAttribute("aria-checked", "false");
  });

  it("asks for the opposite value when pressed", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Toggle checked={false} onChange={onChange} label="A" />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(<Toggle checked onChange={onChange} label="A" />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("does nothing while disabled", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} label="A" disabled />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("SegmentedControl", () => {
  const options = [
    { value: 5, label: "5s" },
    { value: 10, label: "10s" },
    { value: 15, label: "15s" },
  ];

  it("is a labelled radio group with the current value selected", () => {
    render(<SegmentedControl label="Seek time" value={10} options={options} onChange={() => {}} />);
    expect(screen.getByRole("radiogroup", { name: "Seek time" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "10s" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "5s" })).toHaveAttribute("aria-checked", "false");
  });

  it("reports the chosen value, typed as the option's own type (a number stays a number)", () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Seek time" value={10} options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "15s" }));
    expect(onChange).toHaveBeenCalledWith(15);
  });

  it("doesn't fire when the already-selected option is pressed", () => {
    const onChange = vi.fn();
    render(<SegmentedControl label="Seek time" value={10} options={options} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "10s" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("SettingsCard / SettingRow / ComingSoon", () => {
  it("renders a titled card whose rows tie label to control", () => {
    render(
      <SettingsCard title="Playback" description="How it plays.">
        <SettingRow label="Volume" description="Loudness" htmlFor="vol">
          <input id="vol" />
        </SettingRow>
      </SettingsCard>
    );
    expect(screen.getByRole("heading", { name: "Playback" })).toBeInTheDocument();
    expect(screen.getByText("How it plays.")).toBeInTheDocument();
    expect(screen.getByLabelText("Volume")).toBeInTheDocument();
    expect(screen.getByText("Loudness")).toBeInTheDocument();
  });

  it("ComingSoon lists what's planned and says so honestly", () => {
    render(<ComingSoon title="Appearance" items={["Themes", "Layouts"]} />);
    expect(screen.getByRole("heading", { name: "Appearance" })).toBeInTheDocument();
    expect(screen.getByText(/coming in an upcoming update/i)).toBeInTheDocument();
    expect(screen.getByText("Themes")).toBeInTheDocument();
    expect(screen.getByText("Layouts")).toBeInTheDocument();
  });
});
