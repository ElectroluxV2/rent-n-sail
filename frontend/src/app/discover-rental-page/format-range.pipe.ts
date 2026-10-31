import { Pipe, PipeTransform } from '@angular/core';

interface NumberFormatWithRange extends Intl.NumberFormat {
  formatRange(start: number, end: number): string;
}

@Pipe({ name: 'formatRange', standalone: true })
export class FormatRangePipe implements PipeTransform {
  transform(start: number, end: number): string {
    return (new Intl.NumberFormat() as NumberFormatWithRange).formatRange(start, end);
  }
}
