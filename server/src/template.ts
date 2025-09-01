import Handlebars from "handlebars";

export function setupTemplateHelper(): void {
  Handlebars.registerHelper(
    "renumber",
    function (num1: string, num2: number, padding: number | unknown) {
      const pad = typeof padding == "number" ? padding : 2;
      return (Number(num1) - num2).toString().padStart(pad, "0");
    },
  );

  Handlebars.registerHelper(
    "ifContains",
    function (this: any, value: string, substring: string, options: any) {
      if (value.includes(substring)) {
        return options.fn(this); // Then branch
      } else {
        return options.inverse(this); // Else branch
      }
    },
  );
}
