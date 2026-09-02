/* eslint-disable @typescript-eslint/no-unused-vars */
/**
 * React JSX typings for the WebMCP declarative API attributes
 * (`<form toolname=... toolautosubmit>` etc.).
 */
import "react";

declare module "react" {
  interface FormHTMLAttributes<T> {
    toolname?: string;
    tooldescription?: string;
    /** Boolean HTML attribute — pass "" in JSX so React renders it without a warning. */
    toolautosubmit?: string;
  }
  interface InputHTMLAttributes<T> {
    toolparamdescription?: string;
  }
  interface SelectHTMLAttributes<T> {
    toolparamdescription?: string;
  }
  interface TextAreaHTMLAttributes<T> {
    toolparamdescription?: string;
  }
}
